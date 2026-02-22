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

  it("parses explicitly indexed Lua tables for calendar events and attendees", () => {
    const source = `
PuschelzDB = {
  ["schemaVersion"] = 14,
  ["updatedAt"] = 1771778730000,
  ["guildBank"] = {
    ["lastScannedAt"] = 1771778727000,
    ["tabs"] = {
      [1] = {
        ["tabIndex"] = 0,
        ["tabName"] = "Consumables",
        ["items"] = {
          [1] = {
            ["slotIndex"] = 0,
            ["itemId"] = 191381,
            ["itemName"] = "Phial of Tepid Versatility",
            ["itemIcon"] = "134829",
            ["quantity"] = 20,
          },
        },
      },
    },
  },
  ["calendar"] = {
    ["lastScannedAt"] = 1771778727000,
    ["events"] = {
      [1] = {
        ["wowEventId"] = 6653320,
        ["attendees"] = {
          [1] = {
            ["name"] = "Aeyzomage-Blackmoore",
            ["status"] = "signedUp",
          },
          [2] = {
            ["name"] = "Foo-Bar",
            ["status"] = "tentative",
          },
        },
        ["endTime"] = 1770759000000,
        ["startTime"] = 1770748200000,
        ["eventType"] = "raid",
        ["title"] = "ID Fortsetzung",
      },
      [2] = {
        ["wowEventId"] = 1670,
        ["endTime"] = 1771992000000,
        ["startTime"] = 1769572800000,
        ["eventType"] = "world",
        ["title"] = "Winds of Mysterious Fortune",
      },
    },
  },
}
`;

    const parsed = parseSavedVariables(source);
    expect(parsed.guildBank.tabs).toEqual([
      {
        tabIndex: 0,
        tabName: "Consumables",
        items: [
          {
            slotIndex: 0,
            itemId: 191381,
            itemName: "Phial of Tepid Versatility",
            itemIcon: "134829",
            quantity: 20,
          },
        ],
      },
    ]);
    expect(parsed.calendar.events).toEqual([
      {
        wowEventId: 6653320,
        title: "ID Fortsetzung",
        eventType: "raid",
        startTime: 1770748200000,
        endTime: 1770759000000,
        attendees: [
          { name: "Aeyzomage-Blackmoore", status: "signedUp" },
          { name: "Foo-Bar", status: "tentative" },
        ],
      },
      {
        wowEventId: 1670,
        title: "Winds of Mysterious Fortune",
        eventType: "world",
        startTime: 1769572800000,
        endTime: 1771992000000,
      },
    ]);
  });
});
