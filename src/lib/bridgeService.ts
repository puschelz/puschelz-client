import fs from "node:fs/promises";
import path from "node:path";
import { resolveSavedVariablesFile } from "./pathResolver";
import type { BridgeRequiredAddon, BridgeSnapshot, SyncConfig } from "./types";

const BRIDGE_SCHEMA_VERSION = 1;
const BRIDGE_FETCH_TIMEOUT_MS = 10_000;

function escapeLuaString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

function renderLuaString(value: string): string {
  return `"${escapeLuaString(value)}"`;
}

function renderLuaStringArray(values: string[]): string {
  if (values.length === 0) {
    return "{}";
  }
  return `{ ${values.map((value) => renderLuaString(value)).join(", ")} }`;
}

function renderRequiredAddon(addon: BridgeRequiredAddon): string {
  const fields = [
    `addonId = ${renderLuaString(addon.addonId)}`,
    `name = ${renderLuaString(addon.name)}`,
    addon.description ? `description = ${renderLuaString(addon.description)}` : null,
    `matchFolderNames = ${renderLuaStringArray(addon.matchFolderNames)}`,
  ].filter((value): value is string => value !== null);

  return `    { ${fields.join(", ")} },`;
}

function resolveBridgeUrl(endpointUrl: string): string {
  const trimmed = endpointUrl.trim().replace(/\/+$/, "");
  if (/\/api\/addon-sync$/i.test(trimmed)) {
    return trimmed.replace(/\/api\/addon-sync$/i, "/api/addon-bridge");
  }
  if (/\/api\/addon-bridge$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/api/addon-bridge`;
}

function renderBridgeLua(snapshot: BridgeSnapshot): string {
  const recipeLines = snapshot.recipes
    .sort((left, right) => {
      if (left.spellId !== right.spellId) return left.spellId - right.spellId;
      return left.itemId - right.itemId;
    })
    .map(
      (recipe) =>
        `    ["${recipe.spellId}:${recipe.itemId}"] = { crafterCount = ${recipe.crafterCount}, matchedCharacterKeys = ${renderLuaStringArray(recipe.matchedCharacterKeys)} },`
    );
  const requestLines = snapshot.openRequests
    .map((request) => {
      const fields = [
        `requestId = ${renderLuaString(request.requestId)}`,
        `status = ${renderLuaString(request.status)}`,
        `requesterCharacterName = ${renderLuaString(request.requesterCharacterName)}`,
        `requesterRealmName = ${renderLuaString(request.requesterRealmName)}`,
        `spellId = ${request.spellId}`,
        `itemId = ${request.itemId}`,
        `itemName = ${renderLuaString(request.itemName)}`,
        typeof request.quality === "number" ? `quality = ${request.quality}` : null,
        request.note ? `note = ${renderLuaString(request.note)}` : null,
        `expiresAt = ${request.expiresAt}`,
        `matchedCharacterKeys = ${renderLuaStringArray(request.matchedCharacterKeys)}`,
      ].filter((value): value is string => value !== null);
      return `    { ${fields.join(", ")} },`;
    });
  const requiredAddonLines = snapshot.requiredAddons
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
    .map((addon) => renderRequiredAddon(addon));

  return `PuschelzBridgeDB = {
  schemaVersion = ${BRIDGE_SCHEMA_VERSION},
  snapshotVersion = ${snapshot.snapshotVersion},
  requiredAddonsVersion = ${snapshot.requiredAddonsVersion},
  generatedAt = ${snapshot.generatedAt},
  recipesByKey = {
${recipeLines.join("\n")}
  },
  openRequests = {
${requestLines.join("\n")}
  },
  requiredAddons = {
${requiredAddonLines.join("\n")}
  },
}
`;
}

export class BridgeService {
  private lastBridgeVersionKey: string | null = null;
  private lastWrittenPath: string | null = null;

  async refresh(config: SyncConfig): Promise<{ filePath: string; snapshotVersion: number } | null> {
    if (!config.endpointUrl.trim() || !config.apiToken.trim() || !config.wowPath.trim()) {
      return null;
    }

    const savedVariablesFile = await resolveSavedVariablesFile(config.wowPath);
    if (!savedVariablesFile) {
      throw new Error("Could not locate Puschelz.lua under the configured WoW path");
    }

    const response = await fetch(resolveBridgeUrl(config.endpointUrl), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
      },
      signal: AbortSignal.timeout(BRIDGE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Bridge refresh failed (${response.status}): ${body}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Bridge refresh returned invalid JSON");
    }

    const rawSnapshot = payload as Partial<BridgeSnapshot>;
    if (
      typeof rawSnapshot.snapshotVersion !== "number" ||
      typeof rawSnapshot.generatedAt !== "number" ||
      !Array.isArray(rawSnapshot.recipes) ||
      !Array.isArray(rawSnapshot.openRequests)
    ) {
      throw new Error("Bridge refresh returned an invalid payload");
    }

    if (
      rawSnapshot.requiredAddonsVersion !== undefined &&
      typeof rawSnapshot.requiredAddonsVersion !== "number"
    ) {
      throw new Error("Bridge refresh returned an invalid payload");
    }
    if (
      rawSnapshot.requiredAddons !== undefined &&
      !Array.isArray(rawSnapshot.requiredAddons)
    ) {
      throw new Error("Bridge refresh returned an invalid payload");
    }

    const snapshot: BridgeSnapshot = {
      snapshotVersion: rawSnapshot.snapshotVersion,
      requiredAddonsVersion: rawSnapshot.requiredAddonsVersion ?? 0,
      generatedAt: rawSnapshot.generatedAt,
      recipes: rawSnapshot.recipes,
      openRequests: rawSnapshot.openRequests,
      requiredAddons: rawSnapshot.requiredAddons ?? [],
    };

    const bridgePath = path.join(path.dirname(savedVariablesFile), "PuschelzBridge.lua");
    const renderedBridge = renderBridgeLua(snapshot);
    const bridgeVersionKey = `${snapshot.snapshotVersion}:${snapshot.requiredAddonsVersion}`;
    if (
      this.lastBridgeVersionKey === bridgeVersionKey &&
      this.lastWrittenPath === bridgePath
    ) {
      try {
        const existingBridge = await fs.readFile(bridgePath, "utf8");
        if (existingBridge === renderedBridge) {
          return {
            filePath: bridgePath,
            snapshotVersion: snapshot.snapshotVersion,
          };
        }
      } catch {
        // Missing or unreadable bridge files should be rewritten from the fetched snapshot.
      };
    }

    await fs.mkdir(path.dirname(bridgePath), { recursive: true });
    await fs.writeFile(bridgePath, renderedBridge, "utf8");
    this.lastBridgeVersionKey = bridgeVersionKey;
    this.lastWrittenPath = bridgePath;
    return {
      filePath: bridgePath,
      snapshotVersion: snapshot.snapshotVersion,
    };
  }
}
