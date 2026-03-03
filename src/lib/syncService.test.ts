import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncService } from "./syncService";

const LUA_FIXTURE = `
PuschelzDB = {
  schemaVersion = 14,
  updatedAt = 1739400000000,
  guildBank = {
    lastScannedAt = 1739400000000,
    tabs = {},
  },
  calendar = {
    lastScannedAt = 1739403600000,
    events = {},
  },
}
`;

const LUA_FIXTURE_WITH_ATTENDEES = `
PuschelzDB = {
  schemaVersion = 14,
  updatedAt = 1772571273000,
  guildBank = {
    lastScannedAt = 1739400000000,
    tabs = {},
  },
  calendar = {
    lastScannedAt = 1772570853000,
    events = {
      {
        wowEventId = 6655115,
        title = "Mainraid NHC",
        eventType = "raid",
        startTime = 1773858600000,
        endTime = 1773869400000,
        attendees = {
          { name = "Aeyzomage-Blackmoore", status = "signedUp" },
          { name = "Lasstmiranda-Mal'Ganis", status = "signedUp" },
          { name = "Saphíron-Silvermoon", status = "signedUp" },
          { name = "Tábàluga-Blackhand", status = "tentative" },
        },
      },
    },
  },
}
`;

describe("SyncService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses endpoint URL directly when full /api/addon-sync URL is configured", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puschelz-sync-test-"));
    const filePath = path.join(tempDir, "Puschelz.lua");
    fs.writeFileSync(filePath, LUA_FIXTURE, "utf8");

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new SyncService();
    await service.sync(filePath, {
      endpointUrl: "https://example.convex.site/api/addon-sync",
      apiToken: "pz_test",
      wowPath: "C:/World of Warcraft",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.convex.site/api/addon-sync");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns actionable error for html 404 responses", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puschelz-sync-test-"));
    const filePath = path.join(tempDir, "Puschelz.lua");
    fs.writeFileSync(filePath, LUA_FIXTURE, "utf8");

    const fetchMock = vi.fn(async () => {
      return new Response("<!DOCTYPE html><title>404</title>", {
        status: 404,
        headers: { "Content-Type": "text/html" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new SyncService();

    await expect(
      service.sync(filePath, {
        endpointUrl: "https://puschelz.de",
        apiToken: "pz_test",
        wowPath: "C:/World of Warcraft",
      })
    ).rejects.toThrow(/Sync endpoint not found \(404\) at https:\/\/puschelz\.de\/api\/addon-sync/);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("includes raid attendees from SavedVariables in the calendar sync payload", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puschelz-sync-test-"));
    const filePath = path.join(tempDir, "Puschelz.lua");
    fs.writeFileSync(filePath, LUA_FIXTURE_WITH_ATTENDEES, "utf8");

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new SyncService();
    await service.sync(filePath, {
      endpointUrl: "https://example.convex.site",
      apiToken: "pz_test",
      wowPath: "C:/World of Warcraft",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, calendarRequest] = fetchMock.mock.calls[1] ?? [];
    expect(typeof calendarRequest?.body).toBe("string");
    const payload = JSON.parse(String(calendarRequest?.body)) as {
      type: string;
      payload: {
        events: Array<{
          wowEventId: number;
          attendees?: Array<{ name: string; status: string }>;
        }>;
      };
    };

    expect(payload.type).toBe("calendar");
    expect(payload.payload.events).toEqual([
      {
        wowEventId: 6655115,
        title: "Mainraid NHC",
        eventType: "raid",
        startTime: 1773858600000,
        endTime: 1773869400000,
        attendees: [
          { name: "Aeyzomage-Blackmoore", status: "signedUp" },
          { name: "Lasstmiranda-Mal'Ganis", status: "signedUp" },
          { name: "Saphíron-Silvermoon", status: "signedUp" },
          { name: "Tábàluga-Blackhand", status: "tentative" },
        ],
      },
    ]);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
