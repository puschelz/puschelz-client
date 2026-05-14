import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncService } from "./syncService";

const LUA_FIXTURE = `
PuschelzDB = {
  schemaVersion = 15,
  updatedAt = 1739400000000,
  guildBank = {
    lastScannedAt = 1739400000000,
    tabs = {},
  },
  calendar = {
    lastScannedAt = 1739403600000,
    events = {},
  },
  guildOrders = {
    lastScannedAt = 1739407200000,
    orders = {},
  },
}
`;

const LUA_FIXTURE_WITH_ATTENDEES = `
PuschelzDB = {
  schemaVersion = 16,
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
  guildOrders = {
    lastScannedAt = 1772571273000,
    orders = {
      {
        orderId = 777,
        itemId = 225646,
        spellId = 447379,
        orderType = "guild",
        orderState = 2,
        expirationTime = 1773858600000,
        minQuality = 3,
        tipAmount = 150000,
        consortiumCut = 0,
        isRecraft = false,
        isFulfillable = true,
        reagentState = 0,
        customerName = "Requester-Blackhand",
        customerNotes = "Need for raid",
        outputItemHyperlink = "|cff0070dd|Hitem:225646::::::::80:::::|h[Blessed Weapon Grip]|h|r",
      },
    },
  },
  simcRequest = {
    requestId = "simc-player-1",
    requestedAt = 1772572273000,
    characterName = "Fluffybear",
    realmName = "Blackhand",
    profileText = "# Fluffybear-Blackhand\\nhead=id=228911,ilevel=639\\nmain_hand=id=228921,ilevel=645",
    runDroptimizerNow = true,
  },
}
`;

const LUA_FIXTURE_WITH_PENDING_RELOAD = `
PuschelzDB = {
  schemaVersion = 17,
  updatedAt = 1772571273000,
  player = {
    characterName = "Desktopauth",
    realmName = "Blackhand",
  },
  guildBank = {
    lastScannedAt = 1739400000000,
    tabs = {},
  },
  calendar = {
    lastScannedAt = 1772570853000,
    events = {},
  },
  guildOrders = {
    lastScannedAt = 1772571273000,
    orders = {},
  },
  pendingReload = {
    subjectKey = "Queueowner-Blackhand",
    subjectName = "Queueowner-Blackhand",
    payloadVersion = 9,
    payloadFingerprint = "pending-9",
    changedScopes = { "calendar", "guildOrders" },
    scopeSignatures = {
      calendar = "calendar:9",
      guildOrders = "guildOrders:9",
    },
    createdAt = 1772571200000,
    updatedAt = 1772571273000,
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

    expect(fetchMock).toHaveBeenCalledTimes(3);
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

    expect(fetchMock).toHaveBeenCalledTimes(4);
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

  it("includes guild orders in the third sync payload", async () => {
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

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [, guildOrdersRequest] = fetchMock.mock.calls[2] ?? [];
    expect(typeof guildOrdersRequest?.body).toBe("string");
    const payload = JSON.parse(String(guildOrdersRequest?.body)) as {
      type: string;
      payload: {
        scannedAt: number;
        orders: Array<{
          orderId: number;
          itemId: number;
          spellId: number;
          orderType: string;
        }>;
      };
    };

    expect(payload).toMatchObject({
      type: "guildOrders",
      payload: {
        scannedAt: 1772571273000,
        orders: [
          {
            orderId: 777,
            itemId: 225646,
            spellId: 447379,
            orderType: "guild",
            orderState: 2,
            expirationTime: 1773858600000,
            minQuality: 3,
            tipAmount: 150000,
            consortiumCut: 0,
            isRecraft: false,
            isFulfillable: true,
            reagentState: 0,
            customerName: "Requester-Blackhand",
            customerNotes: "Need for raid",
            outputItemHyperlink:
              "|cff0070dd|Hitem:225646::::::::80:::::|h[Blessed Weapon Grip]|h|r",
          },
        ],
      },
      subject: {
        subjectKey: "unknown",
      },
      syncContext: {
        executor: {
          type: "authenticatedUser",
        },
      },
    });

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("includes a simcProfile payload when SavedVariables contain a pending SimC request", async () => {
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

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [, simcRequest] = fetchMock.mock.calls[3] ?? [];
    expect(typeof simcRequest?.body).toBe("string");

    const payload = JSON.parse(String(simcRequest?.body)) as {
      type: string;
      payload: {
        requestId: string;
        scannedAt: number;
        characterName: string;
        realmName: string;
        profileText: string;
        runDroptimizerNow: boolean;
      };
    };

    expect(payload).toMatchObject({
      type: "simcProfile",
      payload: {
        requestId: "simc-player-1",
        scannedAt: 1772572273000,
        characterName: "Fluffybear",
        realmName: "Blackhand",
        profileText: "# Fluffybear-Blackhand\nhead=id=228911,ilevel=639\nmain_hand=id=228921,ilevel=645",
        runDroptimizerNow: true,
      },
      subject: {
        subjectKey: "unknown",
      },
      syncContext: {
        executor: {
          type: "authenticatedUser",
        },
      },
    });

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("includes subject and sync metadata in upload payloads and writes a bridge acknowledgment", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puschelz-sync-test-"));
    const filePath = path.join(tempDir, "Puschelz.lua");
    fs.writeFileSync(filePath, LUA_FIXTURE_WITH_PENDING_RELOAD, "utf8");
    fs.writeFileSync(
      path.join(tempDir, "PuschelzBridge.lua"),
      `PuschelzBridgeDB = {
  schemaVersion = 1,
  snapshotVersion = 55,
  requiredAddonsVersion = 0,
  requiredAddonsConfiguredCount = 0,
  invalidRequiredAddonCount = 0,
  generatedAt = 1772570000000,
  recipesByKey = {
  },
  openRequests = {
  },
  requiredAddons = {
  },
}
`,
      "utf8"
    );

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1772571300000);

    const service = new SyncService();
    await service.sync(filePath, {
      endpointUrl: "https://example.convex.site",
      apiToken: "pz_test",
      wowPath: "C:/World of Warcraft",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [, firstRequest] = fetchMock.mock.calls[0] ?? [];
    expect(typeof firstRequest?.body).toBe("string");
    const payload = JSON.parse(String(firstRequest?.body)) as {
      type: string;
      subject: {
        subjectKey: string;
        subjectName?: string;
        characterName?: string;
        realmName?: string;
      };
      syncContext: {
        payloadVersion?: number;
        payloadFingerprint?: string;
        changedScopes?: string[];
        scopeSignatures?: Record<string, string>;
        createdAt?: number;
        updatedAt?: number;
        executor: {
          type: string;
        };
      };
    };

    expect(payload.subject).toEqual({
      subjectKey: "queueowner-blackhand",
      subjectName: "Queueowner-Blackhand",
      characterName: "Desktopauth",
      realmName: "Blackhand",
    });
    expect(payload.syncContext).toEqual({
      payloadVersion: 9,
      payloadFingerprint: "pending-9",
      changedScopes: ["calendar", "guildOrders"],
      scopeSignatures: {
        calendar: "calendar:9",
        guildOrders: "guildOrders:9",
      },
      createdAt: 1772571200000,
      updatedAt: 1772571273000,
      executor: {
        type: "authenticatedUser",
      },
    });

    const bridgeSource = fs.readFileSync(path.join(tempDir, "PuschelzBridge.lua"), "utf8");
    expect(bridgeSource).toContain("snapshotVersion = 55");
    expect(bridgeSource).toContain('["queueowner-blackhand"] = { subjectKey = "queueowner-blackhand"');
    expect(bridgeSource).toContain("payloadVersion = 9");
    expect(bridgeSource).toContain("acknowledgedAt = 1772571300000");

    nowSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
