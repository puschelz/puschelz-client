import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const WINDOWS_REGISTRY_KEYS = [
  "HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft",
  "HKLM\\SOFTWARE\\Blizzard Entertainment\\World of Warcraft",
  "HKCU\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft",
  "HKCU\\SOFTWARE\\Blizzard Entertainment\\World of Warcraft",
] as const;

const COMMON_WINDOWS_PATHS = [
  "C:\\Program Files (x86)\\World of Warcraft",
  "C:\\Program Files\\World of Warcraft",
] as const;

function normalizeRegistryPath(value: string): string {
  return value.trim().replace(/^"|"$/g, "");
}

function looksLikeWowRoot(candidate: string): boolean {
  if (!candidate || !fs.existsSync(candidate)) {
    return false;
  }

  const checks = ["_retail_", "WTF", "Data", "Launcher.exe"];
  return checks.some((entry) => fs.existsSync(path.join(candidate, entry)));
}

function queryWindowsInstallPath(): string | null {
  for (const key of WINDOWS_REGISTRY_KEYS) {
    try {
      const output = execFileSync("reg", ["query", key, "/v", "InstallPath"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });

      const match = output.match(/InstallPath\s+REG_\w+\s+(.+)/);
      if (!match) {
        continue;
      }

      const candidate = normalizeRegistryPath(match[1] ?? "");
      if (looksLikeWowRoot(candidate)) {
        return candidate;
      }
    } catch {
      // Continue to next key/path.
    }
  }

  return null;
}

export function detectWowInstallPath(): string | null {
  if (process.platform === "win32") {
    const fromRegistry = queryWindowsInstallPath();
    if (fromRegistry) {
      return fromRegistry;
    }

    for (const candidate of COMMON_WINDOWS_PATHS) {
      if (looksLikeWowRoot(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  return null;
}
