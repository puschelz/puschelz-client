import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSavedVariables } from "./luaParser";

describe("parseSavedVariables", () => {
  it("parses addon SavedVariables fixture into expected JSON", () => {
    const fixturePath = path.resolve(process.cwd(), "fixtures/Puschelz.sample.lua");
    const expectedPath = path.resolve(process.cwd(), "fixtures/Puschelz.sample.expected.json");

    const source = fs.readFileSync(fixturePath, "utf8");
    const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8"));

    const parsed = parseSavedVariables(source);
    expect(parsed).toEqual(expected);
  });
});
