import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupOldInstalledVersions,
  getCurrentVersionDir,
  getVersionRootDir,
  listStaleVersionDirs,
} from "./windowsAppCleanup";

const tempDirs: string[] = [];

async function createInstallTree(currentVersion: string, extras: string[] = []): Promise<string> {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "puschelz-client-"));
  tempDirs.push(baseDir);

  await fs.mkdir(path.join(baseDir, currentVersion));
  await fs.writeFile(path.join(baseDir, currentVersion, "Puschelz Client.exe"), "");

  for (const dir of extras) {
    await fs.mkdir(path.join(baseDir, dir));
  }

  return path.join(baseDir, currentVersion, "Puschelz Client.exe");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    })
  );
});

describe("windowsAppCleanup", () => {
  it("detects the current Squirrel version directory from the executable path", async () => {
    const execPath = await createInstallTree("app-0.1.27");
    expect(getCurrentVersionDir(execPath)).toBe("app-0.1.27");
    expect(getVersionRootDir(execPath)).toBe(path.dirname(path.dirname(execPath)));
  });

  it("returns no stale directories outside a Squirrel app-* layout", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "puschelz-client-"));
    tempDirs.push(baseDir);
    const execPath = path.join(baseDir, "Puschelz Client.exe");
    await fs.writeFile(execPath, "");

    expect(getCurrentVersionDir(execPath)).toBeNull();
    await expect(listStaleVersionDirs(execPath)).resolves.toEqual([]);
  });

  it("lists only stale version directories and ignores non-version siblings", async () => {
    const execPath = await createInstallTree("app-0.1.27", [
      "app-0.1.25",
      "app-0.1.26",
      "packages",
      "current",
      "app-temp",
    ]);

    await expect(listStaleVersionDirs(execPath)).resolves.toEqual([
      "app-0.1.25",
      "app-0.1.26",
    ]);
  });

  it("removes only stale installed versions", async () => {
    const execPath = await createInstallTree("app-0.1.27", [
      "app-0.1.25",
      "app-0.1.26",
      "packages",
    ]);
    const rootDir = getVersionRootDir(execPath);

    await expect(cleanupOldInstalledVersions(execPath)).resolves.toEqual([
      "app-0.1.25",
      "app-0.1.26",
    ]);

    const remainingEntries = (await fs.readdir(rootDir!)).sort();
    expect(remainingEntries).toEqual(["app-0.1.27", "packages"]);
  });
});
