import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

describe("configRenderer compile output", () => {
  it("does not emit CommonJS exports for browser execution", () => {
    const filePath = path.resolve(process.cwd(), "src/renderer/configRenderer.ts");
    const source = fs.readFileSync(filePath, "utf8");

    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
      fileName: "configRenderer.ts",
    }).outputText;

    expect(compiled).not.toContain("Object.defineProperty(exports");
    expect(compiled).not.toContain("exports.");
  });
});
