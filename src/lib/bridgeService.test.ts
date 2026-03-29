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
    requiredAddonsVersion: snapshotVersion + 100,
    requiredAddonsConfiguredCount: 1,
    invalidRequiredAddonCount: 0,
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
    requiredAddons: [
      {
        addonId: "abc123",
        name: "WeakAuras",
        description: "Aura helper",
        matchFolderNames: ["WeakAuras", "WeakAurasOptions"],
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
    expect(bridgeSource).toContain("requiredAddonsVersion = 142");
    expect(bridgeSource).toContain("requiredAddonsConfiguredCount = 1");
    expect(bridgeSource).toContain("invalidRequiredAddonCount = 0");
    expect(bridgeSource).toContain('name = "WeakAuras"');
    expect(bridgeSource).toContain('matchFolderNames = { "WeakAuras", "WeakAurasOptions" }');

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

  it("rewrites when the on-disk bridge file diverges even if snapshotVersion is unchanged", async () => {
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
            requiredAddonsVersion: 17,
            requiredAddonsConfiguredCount: 0,
            invalidRequiredAddonCount: 0,
            generatedAt: 1773000000000,
            recipes: [],
            openRequests: [],
            requiredAddons: [],
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

    expect(fs.readFileSync(bridgePath, "utf8")).not.toContain("-- sentinel");
    expect(fs.readFileSync(bridgePath, "utf8")).toContain("snapshotVersion = 7");

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

  it("rewrites the bridge file when requiredAddonsVersion changes even if snapshotVersion is unchanged", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puschelz-bridge-test-"));
    const filePath = path.join(tempDir, "Puschelz.lua");
    fs.writeFileSync(filePath, LUA_FIXTURE, "utf8");
    vi.mocked(resolveSavedVariablesFile).mockResolvedValue(filePath);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            snapshotVersion: 21,
            requiredAddonsVersion: 200,
            requiredAddonsConfiguredCount: 1,
            invalidRequiredAddonCount: 0,
            generatedAt: 1773000000000,
            recipes: [],
            openRequests: [],
            requiredAddons: [
              {
                addonId: "wa",
                name: "WeakAuras",
                matchFolderNames: ["WeakAuras"],
              },
            ],
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
    expect(fs.readFileSync(bridgePath, "utf8")).toContain("requiredAddonsVersion = 200");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            snapshotVersion: 21,
            requiredAddonsVersion: 201,
            requiredAddonsConfiguredCount: 2,
            invalidRequiredAddonCount: 1,
            generatedAt: 1773000000000,
            recipes: [],
            openRequests: [],
            requiredAddons: [
              {
                addonId: "wa",
                name: "WeakAuras",
                matchFolderNames: ["WeakAuras", "WeakAurasOptions"],
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      })
    );

    await service.refresh({
      endpointUrl: "https://puschelz.de",
      apiToken: "pz_test",
      wowPath: "/unused/by-mock",
    });

    const bridgeSource = fs.readFileSync(bridgePath, "utf8");
    expect(bridgeSource).toContain("requiredAddonsVersion = 201");
    expect(bridgeSource).toContain("requiredAddonsConfiguredCount = 2");
    expect(bridgeSource).toContain("invalidRequiredAddonCount = 1");
    expect(bridgeSource).toContain('matchFolderNames = { "WeakAuras", "WeakAurasOptions" }');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("accepts legacy bridge payloads without required addon fields", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puschelz-bridge-test-"));
    const filePath = path.join(tempDir, "Puschelz.lua");
    fs.writeFileSync(filePath, LUA_FIXTURE, "utf8");
    vi.mocked(resolveSavedVariablesFile).mockResolvedValue(filePath);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            snapshotVersion: 55,
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
    const result = await service.refresh({
      endpointUrl: "https://puschelz.de",
      apiToken: "pz_test",
      wowPath: "/unused/by-mock",
    });

    expect(result).toEqual({
      filePath: path.join(tempDir, "PuschelzBridge.lua"),
      snapshotVersion: 55,
    });
    const bridgeSource = fs.readFileSync(path.join(tempDir, "PuschelzBridge.lua"), "utf8");
    expect(bridgeSource).toContain("requiredAddonsVersion = 0");
    expect(bridgeSource).toContain("requiredAddonsConfiguredCount = 0");
    expect(bridgeSource).toContain("invalidRequiredAddonCount = 0");
    expect(bridgeSource).toContain("requiredAddons = {");

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
            requiredAddonsVersion: 17,
            requiredAddonsConfiguredCount: 0,
            invalidRequiredAddonCount: 0,
            generatedAt: 1773000000000,
            recipes: [],
            openRequests: [],
            requiredAddons: [],
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

  it("rejects invalid requiredAddonsVersion payload shapes", async () => {
    vi.mocked(resolveSavedVariablesFile).mockResolvedValue("/tmp/Puschelz.lua");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            snapshotVersion: 88,
            requiredAddonsVersion: "bad",
            requiredAddonsConfiguredCount: 0,
            invalidRequiredAddonCount: 0,
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

  it("rejects invalid required addon diagnostics payload shapes", async () => {
    vi.mocked(resolveSavedVariablesFile).mockResolvedValue("/tmp/Puschelz.lua");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            snapshotVersion: 91,
            requiredAddonsVersion: 18,
            requiredAddonsConfiguredCount: "bad",
            invalidRequiredAddonCount: 0,
            generatedAt: 1773000000000,
            recipes: [],
            openRequests: [],
            requiredAddons: [],
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

  it("rejects invalid invalidRequiredAddonCount payload shapes", async () => {
    vi.mocked(resolveSavedVariablesFile).mockResolvedValue("/tmp/Puschelz.lua");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            snapshotVersion: 92,
            requiredAddonsVersion: 19,
            requiredAddonsConfiguredCount: 0,
            invalidRequiredAddonCount: "bad",
            generatedAt: 1773000000000,
            recipes: [],
            openRequests: [],
            requiredAddons: [],
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
