import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import type { SyncConfig } from "./types";
import { parseSavedVariables } from "./luaParser";

export class SyncService {
  private lastContentHash: string | null = null;

  async sync(filePath: string, config: SyncConfig): Promise<void> {
    if (!config.endpointUrl || !config.apiToken) {
      throw new Error("Missing endpoint URL or API token");
    }

    const source = await fs.readFile(filePath, "utf8");
    const hash = createHash("sha256").update(source).digest("hex");
    if (hash === this.lastContentHash) {
      return;
    }

    const parsed = parseSavedVariables(source);

    const endpoint = config.endpointUrl.replace(/\/$/, "");
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
      const response = await fetch(`${endpoint}/api/addon-sync`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Sync failed (${response.status}): ${body}`);
      }
    }

    this.lastContentHash = hash;
  }
}
