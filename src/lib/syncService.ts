import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import type { SyncConfig } from "./types";
import { parseSavedVariables } from "./luaParser";

export class SyncService {
  private lastContentHash: string | null = null;

  private resolveSyncUrl(endpointUrl: string): string {
    const trimmed = endpointUrl.trim().replace(/\/+$/, "");
    if (/\/api\/addon-sync$/i.test(trimmed)) {
      return trimmed;
    }
    return `${trimmed}/api/addon-sync`;
  }

  async sync(filePath: string, config: SyncConfig): Promise<void> {
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
      return;
    }

    const parsed = parseSavedVariables(source);

    const syncUrl = this.resolveSyncUrl(config.endpointUrl);
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiToken}`,
    };

    const payloads = [
      {
        type: "guildBank",
        payload: {
          tabs: parsed.guildBank.tabs,
        },
      },
      {
        type: "calendar",
        payload: {
          events: parsed.calendar.events,
        },
      },
    ];

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

    this.lastContentHash = hash;
  }
}
