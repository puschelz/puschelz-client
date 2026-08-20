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

  it("parses schema 17 pending reload metadata", () => {
    const source = `
PuschelzDB = {
  schemaVersion = 17,
  updatedAt = 1772571273000,
  player = {
    characterName = "Desktoon",
    realmName = "Blackhand",
  },
  guildBank = {
    lastScannedAt = 0,
    tabs = {},
  },
  guildOrders = {
    lastScannedAt = 0,
    orders = {},
  },
  pendingReload = {
    subjectKey = "Desktoon-Blackhand",
    subjectName = "Desktoon-Blackhand",
    payloadVersion = 42,
    payloadFingerprint = "fp-42",
    changedScopes = { "simc" },
    scopeSignatures = {
      simc = "simc:42",
    },
    createdAt = 1772571200000,
    updatedAt = 1772571273000,
  },
}
`;

    const parsed = parseSavedVariables(source);

    expect(parsed.pendingReload).toEqual({
      subjectKey: "desktoon-blackhand",
      subjectName: "Desktoon-Blackhand",
      payloadVersion: 42,
      payloadFingerprint: "fp-42",
      changedScopes: ["simc"],
      scopeSignatures: {
        simc: "simc:42",
      },
      createdAt: 1772571200000,
      updatedAt: 1772571273000,
    });
  });
});
