import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";

export async function resolveSavedVariablesFile(inputPath: string): Promise<string | null> {
  const normalized = inputPath.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.endsWith("Puschelz.lua") && fs.existsSync(normalized)) {
    return normalized;
  }

  const base = path.resolve(normalized);
  const candidates = await fg(
    [
      "_retail_/WTF/Account/*/SavedVariables/Puschelz.lua",
      "WTF/Account/*/SavedVariables/Puschelz.lua",
    ],
    {
      cwd: base,
      absolute: true,
      onlyFiles: true,
      suppressErrors: true,
    }
  );

  if (candidates.length === 0) {
    return null;
  }

  const ranked = candidates
    .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  return ranked[0]?.file ?? null;
}
