import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { SyncConfig } from "./types";

const DEFAULT_CONFIG: SyncConfig = {
  endpointUrl: "https://puschelz.de",
  apiToken: "",
  wowPath: "",
};

export class ConfigStore {
  private readonly configPath: string;

  constructor() {
    this.configPath = path.join(app.getPath("userData"), "config.json");
  }

  getConfig(): SyncConfig {
    try {
      const raw = fs.readFileSync(this.configPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<SyncConfig>;
      return {
        endpointUrl: parsed.endpointUrl ?? DEFAULT_CONFIG.endpointUrl,
        apiToken: parsed.apiToken ?? "",
        wowPath: parsed.wowPath ?? "",
      };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  saveConfig(nextConfig: SyncConfig): void {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(nextConfig, null, 2), "utf8");
  }
}
