import fs from "node:fs/promises";
import path from "node:path";

const VERSION_DIR_PREFIX = "app-";

function isVersionDirName(name: string): boolean {
  return /^app-\d+\.\d+\.\d+(-.+)?$/i.test(name);
}

export function getCurrentVersionDir(execPath: string): string | null {
  const versionDir = path.basename(path.dirname(execPath));
  if (!isVersionDirName(versionDir)) {
    return null;
  }
  return versionDir;
}

export function getVersionRootDir(execPath: string): string | null {
  const currentVersionDir = getCurrentVersionDir(execPath);
  if (!currentVersionDir) {
    return null;
  }
  return path.dirname(path.dirname(execPath));
}

export async function listStaleVersionDirs(execPath: string): Promise<string[]> {
  const currentVersionDir = getCurrentVersionDir(execPath);
  const versionRootDir = getVersionRootDir(execPath);
  if (!currentVersionDir || !versionRootDir) {
    return [];
  }

  const entries = await fs.readdir(versionRootDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(VERSION_DIR_PREFIX))
    .filter((name) => isVersionDirName(name))
    .filter((name) => name !== currentVersionDir)
    .sort();
}

export async function cleanupOldInstalledVersions(execPath: string): Promise<string[]> {
  const versionRootDir = getVersionRootDir(execPath);
  if (!versionRootDir) {
    return [];
  }

  const staleDirs = await listStaleVersionDirs(execPath);
  for (const dirName of staleDirs) {
    await fs.rm(path.join(versionRootDir, dirName), {
      recursive: true,
      force: true,
    });
  }

  return staleDirs;
}
