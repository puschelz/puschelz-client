import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncService } from "./syncService";

const LUA_FIXTURE = `
PuschelzDB = {
  schemaVersion = 13,
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
});
