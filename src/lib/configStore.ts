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
  private configPath: string | null = null;

  private getStableConfigPath(): string {
    if (this.configPath) {
      return this.configPath;
    }

    // Keep settings in a version-independent location to survive upgrades.
    const stableDir = path.join(app.getPath("appData"), "Puschelz Client");
    this.configPath = path.join(stableDir, "config.json");
    return this.configPath;
  }

  private getLegacyConfigPaths(): string[] {
    const appName = app.getName();
    return [
      path.join(app.getPath("userData"), "config.json"),
      path.join(app.getPath("appData"), appName, "config.json"),
    ];
  }

  private migrateLegacyConfigIfNeeded(targetPath: string): void {
    if (fs.existsSync(targetPath)) {
      return;
    }

    for (const legacyPath of this.getLegacyConfigPaths()) {
      if (!legacyPath || legacyPath === targetPath || !fs.existsSync(legacyPath)) {
        continue;
      }

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(legacyPath, targetPath);
      return;
    }
  }

  getConfig(): SyncConfig {
    const configPath = this.getStableConfigPath();
    this.migrateLegacyConfigIfNeeded(configPath);

    try {
      const raw = fs.readFileSync(configPath, "utf8");
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
    const configPath = this.getStableConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 2), "utf8");
  }
}
