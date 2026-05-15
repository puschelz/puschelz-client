import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSavedVariablesFile } from "./pathResolver";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "puschelz-path-resolver-"));
  tempDirs.push(dir);
  return dir;
}

function writeSavedVariablesFile(baseDir: string, accountName: string): string {
  const filePath = path.join(
    baseDir,
    "_retail_",
    "WTF",
    "Account",
    accountName,
    "SavedVariables",
    "Puschelz.lua"
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "PuschelzDB = {}", "utf8");
  return filePath;
}

describe("resolveSavedVariablesFile", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("returns the direct file path when configured explicitly", async () => {
    const tempDir = createTempDir();
    const filePath = writeSavedVariablesFile(tempDir, "Primary");

    await expect(resolveSavedVariablesFile(filePath)).resolves.toBe(filePath);
  });

  it("returns the only discovered SavedVariables file under a WoW root", async () => {
    const tempDir = createTempDir();
    const filePath = writeSavedVariablesFile(tempDir, "Primary");

    await expect(resolveSavedVariablesFile(tempDir)).resolves.toBe(filePath);
  });

  it("throws when multiple SavedVariables files exist under the configured WoW root", async () => {
    const tempDir = createTempDir();
    writeSavedVariablesFile(tempDir, "Primary");
    writeSavedVariablesFile(tempDir, "Alt");

    await expect(resolveSavedVariablesFile(tempDir)).rejects.toThrow(
      "Multiple Puschelz.lua files were found under the configured WoW path. Select the exact SavedVariables/Puschelz.lua file in Settings."
    );
  });
});
