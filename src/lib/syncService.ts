import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ParsedPuschelzDb, SyncConfig } from "./types";
import { parseSavedVariables } from "./luaParser";
import { writeBridgeAcknowledgment } from "./bridgeService";

type SyncEnvelope = {
  type: string;
  payload: unknown;
  subject: {
    subjectKey: string;
    subjectName?: string;
    characterName?: string;
    realmName?: string;
  };
  syncContext: {
    payloadVersion?: number;
    payloadFingerprint?: string;
    changedScopes?: string[];
    scopeSignatures?: Record<string, string>;
    createdAt?: number;
    updatedAt?: number;
    executor: {
      type: "authenticatedUser";
    };
  };
};

export type SyncResult = {
  wroteBridgeAcknowledgment: boolean;
};

function normalizeSegment(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function buildSubject(parsed: ParsedPuschelzDb): SyncEnvelope["subject"] {
  const pendingSubjectKey = parsed.pendingReload?.subjectKey?.trim().toLowerCase();
  if (pendingSubjectKey) {
    return {
      subjectKey: pendingSubjectKey,
      ...(parsed.pendingReload?.subjectName ? { subjectName: parsed.pendingReload.subjectName } : {}),
      ...(parsed.player?.characterName ? { characterName: parsed.player.characterName } : {}),
      ...(parsed.player?.realmName ? { realmName: parsed.player.realmName } : {}),
    };
  }

  const characterName = parsed.player?.characterName?.trim();
  const realmName = parsed.player?.realmName?.trim();
  const subjectKey =
    characterName && realmName
      ? `${normalizeSegment(characterName)}-${normalizeSegment(realmName)}`
      : "unknown";

  return {
    subjectKey,
    ...(characterName && realmName ? { subjectName: `${characterName}-${realmName}` } : {}),
    ...(characterName ? { characterName } : {}),
    ...(realmName ? { realmName } : {}),
  };
}

function buildSyncContext(parsed: ParsedPuschelzDb): SyncEnvelope["syncContext"] {
  return {
    ...(parsed.pendingReload?.payloadVersion
      ? { payloadVersion: parsed.pendingReload.payloadVersion }
      : {}),
    ...(parsed.pendingReload?.payloadFingerprint
      ? { payloadFingerprint: parsed.pendingReload.payloadFingerprint }
      : {}),
    ...(parsed.pendingReload?.changedScopes.length
      ? { changedScopes: parsed.pendingReload.changedScopes }
      : {}),
    ...(Object.keys(parsed.pendingReload?.scopeSignatures ?? {}).length > 0
      ? { scopeSignatures: parsed.pendingReload?.scopeSignatures }
      : {}),
    ...(parsed.pendingReload?.createdAt ? { createdAt: parsed.pendingReload.createdAt } : {}),
    ...(parsed.pendingReload?.updatedAt ? { updatedAt: parsed.pendingReload.updatedAt } : {}),
    executor: {
      type: "authenticatedUser",
    },
  };
}

export class SyncService {
  private lastContentHash: string | null = null;

  private resolveSyncUrl(endpointUrl: string): string {
    const trimmed = endpointUrl.trim().replace(/\/+$/, "");
    if (/\/api\/addon-sync$/i.test(trimmed)) {
      return trimmed;
    }
    return `${trimmed}/api/addon-sync`;
  }

  async sync(filePath: string, config: SyncConfig): Promise<SyncResult> {
    const missing: string[] = [];
    if (!config.endpointUrl.trim()) {
      missing.push("endpoint URL");
    }
    if (!config.apiToken.trim()) {
      missing.push("API token");
    }
    if (missing.length > 0) {
      throw new Error(`Missing required settings: ${missing.join(", ")}`);
    }

    const source = await fs.readFile(filePath, "utf8");
    const hash = createHash("sha256").update(source).digest("hex");
    if (hash === this.lastContentHash) {
      return { wroteBridgeAcknowledgment: false };
    }

    const parsed = parseSavedVariables(source);

    const syncUrl = this.resolveSyncUrl(config.endpointUrl);
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiToken}`,
    };
    const subject = buildSubject(parsed);
    const syncContext = buildSyncContext(parsed);

    const payloads: SyncEnvelope[] = [
      {
        type: "guildBank",
        subject,
        syncContext,
        payload: {
          tabs: parsed.guildBank.tabs,
        },
      },
      {
        type: "guildOrders",
        subject,
        syncContext,
        payload: {
          scannedAt: parsed.guildOrders.lastScannedAt,
          orders: parsed.guildOrders.orders,
        },
      },
    ];

    if (parsed.simcRequest) {
      payloads.push({
        type: "simcProfile",
        subject,
        syncContext,
        payload: {
          requestId: parsed.simcRequest.requestId,
          scannedAt: parsed.simcRequest.requestedAt,
          characterName: parsed.simcRequest.characterName,
          realmName: parsed.simcRequest.realmName,
          profileText: parsed.simcRequest.profileText,
          runDroptimizerNow: parsed.simcRequest.runDroptimizerNow,
        },
      });
    }

    for (const payload of payloads) {
      const response = await fetch(syncUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text();
        const contentType = response.headers.get("content-type") ?? "";

        if (response.status === 401) {
          throw new Error(
            `Sync authentication failed (401) at ${syncUrl}. Check your API token.`
          );
        }

        if (response.status === 404 && contentType.includes("text/html")) {
          throw new Error(
            `Sync endpoint not found (404) at ${syncUrl}. The configured URL does not host /api/addon-sync. Use your Convex site URL (for example https://<deployment>.convex.site) or paste the full /api/addon-sync URL.`
          );
        }

        throw new Error(`Sync failed (${response.status}) at ${syncUrl}: ${body}`);
      }
    }

    let wroteBridgeAcknowledgment = false;
    if (parsed.pendingReload) {
      const acknowledgedAt = Date.now();
      await writeBridgeAcknowledgment(filePath, {
        subjectKey: parsed.pendingReload.subjectKey,
        ...(parsed.pendingReload.subjectName
          ? { subjectName: parsed.pendingReload.subjectName }
          : {}),
        payloadVersion: parsed.pendingReload.payloadVersion,
        acknowledgedAt,
        updatedAt: acknowledgedAt,
      });
      wroteBridgeAcknowledgment = true;
    }

    this.lastContentHash = hash;
    return { wroteBridgeAcknowledgment };
  }
}
