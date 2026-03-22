import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSavedVariablesFile } from "./pathResolver";
import { BridgeService } from "./bridgeService";

vi.mock("./pathResolver", () => ({
  resolveSavedVariablesFile: vi.fn(),
}));

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

function makeSnapshot(snapshotVersion: number) {
  return {
    snapshotVersion,
    generatedAt: 1773000000000,
    recipes: [
      {
        spellId: 447379,
        itemId: 225646,
        crafterCount: 2,
        matchedCharacterKeys: ["treatisecrafter-blackhand", "sheforge-blackhand"],
      },
    ],
    openRequests: [
      {
        requestId: "j57abc",
        status: "pending_web" as const,
        requesterCharacterName: "Requester",
        requesterRealmName: "Blackhand",
        spellId: 447379,
        itemId: 225646,
        itemName: "Blessed Weapon Grip",
        note: "Need for raid",
        expiresAt: 1773003600000,
        matchedCharacterKeys: ["treatisecrafter-blackhand"],
      },
    ],
  };
}

describe("BridgeService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("writes PuschelzBridge.lua next to the resolved SavedVariables file", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puschelz-bridge-test-"));
    const filePath = path.join(tempDir, "Puschelz.lua");
    fs.writeFileSync(filePath, LUA_FIXTURE, "utf8");
    vi.mocked(resolveSavedVariablesFile).mockResolvedValue(filePath);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify(makeSnapshot(42)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    const service = new BridgeService();
    const result = await service.refresh({
      endpointUrl: "https://puschelz.de",
      apiToken: "pz_test",
      wowPath: "/unused/by-mock",
    });

    expect(result).toEqual({
      filePath: path.join(tempDir, "PuschelzBridge.lua"),
      snapshotVersion: 42,
    });

    const bridgeSource = fs.readFileSync(path.join(tempDir, "PuschelzBridge.lua"), "utf8");
    expect(bridgeSource).toContain("PuschelzBridgeDB = {");
    expect(bridgeSource).toContain('["447379:225646"]');
    expect(bridgeSource).toContain('requestId = "j57abc"');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates the bridge directory before writing when it is missing", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puschelz-bridge-test-"));
    const filePath = path.join(tempDir, "Missing", "Puschelz.lua");
    vi.mocked(resolveSavedVariablesFile).mockResolvedValue(filePath);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify(makeSnapshot(18)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    const service = new BridgeService();
    const result = await service.refresh({
      endpointUrl: "https://puschelz.de",
      apiToken: "pz_test",
      wowPath: "/unused/by-mock",
    });

    expect(result).toEqual({
      filePath: path.join(tempDir, "Missing", "PuschelzBridge.lua"),
      snapshotVersion: 18,
    });
    expect(fs.readFileSync(path.join(tempDir, "Missing", "PuschelzBridge.lua"), "utf8")).toContain(
      "snapshotVersion = 18"
    );

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("skips rewriting when snapshotVersion is unchanged", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puschelz-bridge-test-"));
    const filePath = path.join(tempDir, "Puschelz.lua");
    fs.writeFileSync(filePath, LUA_FIXTURE, "utf8");
    vi.mocked(resolveSavedVariablesFile).mockResolvedValue(filePath);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            snapshotVersion: 7,
            generatedAt: 1773000000000,
            recipes: [],
            openRequests: [],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      })
    );

    const service = new BridgeService();
    await service.refresh({
      endpointUrl: "https://puschelz.de",
      apiToken: "pz_test",
      wowPath: "/unused/by-mock",
    });
    const bridgePath = path.join(tempDir, "PuschelzBridge.lua");
    const firstWrite = fs.readFileSync(bridgePath, "utf8");
    fs.writeFileSync(bridgePath, `${firstWrite}\n-- sentinel`, "utf8");

    await service.refresh({
      endpointUrl: "https://puschelz.de",
      apiToken: "pz_test",
      wowPath: "/unused/by-mock",
    });

    expect(fs.readFileSync(bridgePath, "utf8")).toContain("-- sentinel");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("rewrites the bridge file when the WoW path changes even if snapshotVersion is unchanged", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puschelz-bridge-test-"));
    const firstDir = path.join(tempDir, "First");
    const secondDir = path.join(tempDir, "Second");
    const firstFilePath = path.join(firstDir, "Puschelz.lua");
    const secondFilePath = path.join(secondDir, "Puschelz.lua");
    fs.mkdirSync(firstDir, { recursive: true });
    fs.mkdirSync(secondDir, { recursive: true });
    fs.writeFileSync(firstFilePath, LUA_FIXTURE, "utf8");
    fs.writeFileSync(secondFilePath, LUA_FIXTURE, "utf8");

    vi.mocked(resolveSavedVariablesFile)
      .mockResolvedValueOnce(firstFilePath)
      .mockResolvedValueOnce(secondFilePath);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify(makeSnapshot(7)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    const service = new BridgeService();
    await service.refresh({
      endpointUrl: "https://puschelz.de",
      apiToken: "pz_test",
      wowPath: "/unused/by-mock",
    });
    await service.refresh({
      endpointUrl: "https://puschelz.de",
      apiToken: "pz_test",
      wowPath: "/unused/by-mock",
    });

    expect(fs.readFileSync(path.join(firstDir, "PuschelzBridge.lua"), "utf8")).toContain(
      "snapshotVersion = 7"
    );
    expect(fs.readFileSync(path.join(secondDir, "PuschelzBridge.lua"), "utf8")).toContain(
      "snapshotVersion = 7"
    );

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns an actionable error for HTTP failures", async () => {
    vi.mocked(resolveSavedVariablesFile).mockResolvedValue("/tmp/Puschelz.lua");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response("forbidden", {
          status: 403,
          headers: { "Content-Type": "text/plain" },
        });
      })
    );

    const service = new BridgeService();
    await expect(
      service.refresh({
        endpointUrl: "https://puschelz.de",
        apiToken: "pz_test",
        wowPath: "/unused/by-mock",
      })
    ).rejects.toThrow("Bridge refresh failed (403): forbidden");
  });

  it("rejects malformed JSON payloads", async () => {
    vi.mocked(resolveSavedVariablesFile).mockResolvedValue("/tmp/Puschelz.lua");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response("not json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    const service = new BridgeService();
    await expect(
      service.refresh({
        endpointUrl: "https://puschelz.de",
        apiToken: "pz_test",
        wowPath: "/unused/by-mock",
      })
    ).rejects.toThrow("Bridge refresh returned invalid JSON");
  });

  it("rejects invalid bridge payload shapes", async () => {
    vi.mocked(resolveSavedVariablesFile).mockResolvedValue("/tmp/Puschelz.lua");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            snapshotVersion: "bad",
            generatedAt: 1773000000000,
            recipes: [],
            openRequests: [],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      })
    );

    const service = new BridgeService();
    await expect(
      service.refresh({
        endpointUrl: "https://puschelz.de",
        apiToken: "pz_test",
        wowPath: "/unused/by-mock",
      })
    ).rejects.toThrow("Bridge refresh returned an invalid payload");
  });
});
