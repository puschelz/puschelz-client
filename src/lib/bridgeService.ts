import fs from "node:fs/promises";
import path from "node:path";
import { resolveSavedVariablesFile } from "./pathResolver";
import type {
  BridgeRequiredAddon,
  BridgeSnapshot,
  BridgeSyncAcknowledgment,
  SyncConfig,
} from "./types";

const BRIDGE_SCHEMA_VERSION = 1;
const BRIDGE_FETCH_TIMEOUT_MS = 10_000;
const BRIDGE_ACK_SECTION_PATTERN =
  /\r?\n\s*syncAcknowledgments = \{\r?\n[\s\S]*?\r?\n\s*\},(?=\r?\n\})/;

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

function unescapeLuaString(value: string): string {
  return value
    .replace(/\\\\/g, "\\")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r");
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

function renderSyncAcknowledgment(ack: BridgeSyncAcknowledgment): string {
  const fields = [
    `subjectKey = ${renderLuaString(ack.subjectKey)}`,
    ack.subjectName ? `subjectName = ${renderLuaString(ack.subjectName)}` : null,
    `payloadVersion = ${ack.payloadVersion}`,
    typeof ack.acknowledgedAt === "number" ? `acknowledgedAt = ${ack.acknowledgedAt}` : null,
    typeof ack.updatedAt === "number" ? `updatedAt = ${ack.updatedAt}` : null,
  ].filter((value): value is string => value !== null);

  return `    [${renderLuaString(ack.subjectKey)}] = { ${fields.join(", ")} },`;
}

function renderSyncAcknowledgments(acks: Record<string, BridgeSyncAcknowledgment>): string {
  const lines = Object.values(acks)
    .slice()
    .sort((left, right) => left.subjectKey.localeCompare(right.subjectKey))
    .map((ack) => renderSyncAcknowledgment(ack));

  return `  syncAcknowledgments = {\n${lines.join("\n")}\n  },`;
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isBridgeRequiredAddon(value: unknown): value is BridgeRequiredAddon {
  if (!value || typeof value !== "object") {
    return false;
  }

  const addon = value as Record<string, unknown>;
  return (
    typeof addon.addonId === "string" &&
    typeof addon.name === "string" &&
    (addon.description === undefined || typeof addon.description === "string") &&
    isStringArray(addon.matchFolderNames)
  );
}

function parseBridgeAcknowledgments(luaSource: string): Record<string, BridgeSyncAcknowledgment> {
  const sectionMatch = luaSource.match(
    /syncAcknowledgments = \{\r?\n([\s\S]*?)\r?\n\s*\},/
  );
  if (!sectionMatch?.[1]) {
    return {};
  }

  const acknowledgments: Record<string, BridgeSyncAcknowledgment> = {};
  const entryPattern =
    /\["([^"]+)"\] = \{ ([^}]*) \},/g;

  for (const match of sectionMatch[1].matchAll(entryPattern)) {
    const subjectKey = match[1]?.trim().toLowerCase();
    const fields = match[2] ?? "";
    const payloadVersionMatch = fields.match(/payloadVersion = (\d+)/);

    if (!subjectKey || !payloadVersionMatch) {
      continue;
    }

    const subjectNameMatch = fields.match(/subjectName = "((?:\\.|[^"])*)"/);
    const acknowledgedAtMatch = fields.match(/acknowledgedAt = (\d+)/);
    const updatedAtMatch = fields.match(/updatedAt = (\d+)/);
    acknowledgments[subjectKey] = {
      subjectKey,
      ...(subjectNameMatch?.[1]
        ? {
            subjectName: unescapeLuaString(subjectNameMatch[1]),
          }
        : {}),
      payloadVersion: Number(payloadVersionMatch[1]),
      ...(acknowledgedAtMatch ? { acknowledgedAt: Number(acknowledgedAtMatch[1]) } : {}),
      ...(updatedAtMatch ? { updatedAt: Number(updatedAtMatch[1]) } : {}),
    };
  }

  return acknowledgments;
}

async function readBridgeAcknowledgments(
  bridgePath: string
): Promise<Record<string, BridgeSyncAcknowledgment>> {
  try {
    const existing = await fs.readFile(bridgePath, "utf8");
    return parseBridgeAcknowledgments(existing);
  } catch {
    return {};
  }
}

function renderBridgeLua(
  snapshot: BridgeSnapshot,
  acknowledgments: Record<string, BridgeSyncAcknowledgment>
): string {
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
  requiredAddonsConfiguredCount = ${snapshot.requiredAddonsConfiguredCount},
  invalidRequiredAddonCount = ${snapshot.invalidRequiredAddonCount},
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
${renderSyncAcknowledgments(acknowledgments)}
}
`;
}

function buildEmptyBridgeSnapshot(generatedAt: number): BridgeSnapshot {
  return {
    snapshotVersion: 0,
    requiredAddonsVersion: 0,
    requiredAddonsConfiguredCount: 0,
    invalidRequiredAddonCount: 0,
    generatedAt,
    recipes: [],
    openRequests: [],
    requiredAddons: [],
  };
}

export async function writeBridgeAcknowledgment(
  savedVariablesFile: string,
  acknowledgment: BridgeSyncAcknowledgment
): Promise<string> {
  const bridgePath = path.join(path.dirname(savedVariablesFile), "PuschelzBridge.lua");
  const normalizedAck: BridgeSyncAcknowledgment = {
    ...acknowledgment,
    subjectKey: acknowledgment.subjectKey.trim().toLowerCase(),
  };

  let existingSource: string | null = null;
  try {
    existingSource = await fs.readFile(bridgePath, "utf8");
  } catch {
    existingSource = null;
  }

  const acknowledgments = existingSource ? parseBridgeAcknowledgments(existingSource) : {};
  acknowledgments[normalizedAck.subjectKey] = normalizedAck;
  const acknowledgmentsSource = renderSyncAcknowledgments(acknowledgments);

  const nextSource =
    existingSource && existingSource.includes("PuschelzBridgeDB = {")
      ? BRIDGE_ACK_SECTION_PATTERN.test(existingSource)
        ? existingSource.replace(BRIDGE_ACK_SECTION_PATTERN, `\n${acknowledgmentsSource}`)
        : existingSource.replace(/\r?\n\}\r?\n?$/, `\n${acknowledgmentsSource}\n}\n`)
      : renderBridgeLua(buildEmptyBridgeSnapshot(Date.now()), acknowledgments);

  await fs.mkdir(path.dirname(bridgePath), { recursive: true });
  await fs.writeFile(bridgePath, nextSource, "utf8");
  return bridgePath;
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
      !isFiniteNumber(rawSnapshot.snapshotVersion) ||
      !isFiniteNumber(rawSnapshot.generatedAt) ||
      !Array.isArray(rawSnapshot.recipes) ||
      !Array.isArray(rawSnapshot.openRequests)
    ) {
      throw new Error("Bridge refresh returned an invalid payload");
    }

    if (
      rawSnapshot.requiredAddonsVersion !== undefined &&
      !isFiniteNumber(rawSnapshot.requiredAddonsVersion)
    ) {
      throw new Error("Bridge refresh returned an invalid payload");
    }
    if (
      rawSnapshot.requiredAddonsConfiguredCount !== undefined &&
      !isFiniteNumber(rawSnapshot.requiredAddonsConfiguredCount)
    ) {
      throw new Error("Bridge refresh returned an invalid payload");
    }
    if (
      rawSnapshot.invalidRequiredAddonCount !== undefined &&
      !isFiniteNumber(rawSnapshot.invalidRequiredAddonCount)
    ) {
      throw new Error("Bridge refresh returned an invalid payload");
    }
    if (
      rawSnapshot.requiredAddons !== undefined &&
      (!Array.isArray(rawSnapshot.requiredAddons) ||
        !rawSnapshot.requiredAddons.every(isBridgeRequiredAddon))
    ) {
      throw new Error("Bridge refresh returned an invalid payload");
    }

    const requiredAddonCount = rawSnapshot.requiredAddons?.length ?? 0;
    // Legacy bridge payloads may omit the new diagnostics entirely.
    const configuredRequiredAddonCount =
      rawSnapshot.requiredAddonsConfiguredCount ?? requiredAddonCount;

    const snapshot: BridgeSnapshot = {
      snapshotVersion: rawSnapshot.snapshotVersion,
      requiredAddonsVersion: rawSnapshot.requiredAddonsVersion ?? 0,
      requiredAddonsConfiguredCount: configuredRequiredAddonCount,
      invalidRequiredAddonCount:
        rawSnapshot.invalidRequiredAddonCount ??
        Math.max(0, configuredRequiredAddonCount - requiredAddonCount),
      generatedAt: rawSnapshot.generatedAt,
      recipes: rawSnapshot.recipes,
      openRequests: rawSnapshot.openRequests,
      requiredAddons: rawSnapshot.requiredAddons ?? [],
    };

    const bridgePath = path.join(path.dirname(savedVariablesFile), "PuschelzBridge.lua");
    const acknowledgments = await readBridgeAcknowledgments(bridgePath);
    const renderedBridge = renderBridgeLua(snapshot, acknowledgments);
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
