import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let appDataDir = "";
let userDataDir = "";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name === "appData") {
        return appDataDir;
      }
      if (name === "userData") {
        return userDataDir;
      }
      throw new Error(`Unhandled path request: ${name}`);
    },
    getName: () => "Puschelz Client",
  },
}));

describe("ConfigStore", () => {
  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "puschelz-client-config-test-"));
    appDataDir = path.join(root, "appData");
    userDataDir = path.join(root, "userData");
    fs.mkdirSync(appDataDir, { recursive: true });
    fs.mkdirSync(userDataDir, { recursive: true });
  });

  afterEach(() => {
    vi.resetModules();
    if (appDataDir) {
      const root = path.dirname(appDataDir);
      fs.rmSync(root, { recursive: true, force: true });
    }
    appDataDir = "";
    userDataDir = "";
  });

  it("persists config in stable appData location", async () => {
    const { ConfigStore } = await import("./configStore");
    const store = new ConfigStore();

    store.saveConfig({
      endpointUrl: "https://puschelz.de",
      apiToken: "pz_abc",
      wowPath: "C:/World of Warcraft",
    });

    const readBack = store.getConfig();
    expect(readBack).toEqual({
      endpointUrl: "https://puschelz.de",
      apiToken: "pz_abc",
      wowPath: "C:/World of Warcraft",
    });

    const stableConfigPath = path.join(appDataDir, "Puschelz Client", "config.json");
    expect(fs.existsSync(stableConfigPath)).toBe(true);
  });

  it("migrates legacy userData config to stable location", async () => {
    const legacyConfigPath = path.join(userDataDir, "config.json");
    fs.mkdirSync(path.dirname(legacyConfigPath), { recursive: true });
    fs.writeFileSync(
      legacyConfigPath,
      JSON.stringify({
        endpointUrl: "https://puschelz.de",
        apiToken: "pz_legacy",
        wowPath: "D:/Games/World of Warcraft",
      }),
      "utf8"
    );

    const { ConfigStore } = await import("./configStore");
    const store = new ConfigStore();

    const config = store.getConfig();
    expect(config).toEqual({
      endpointUrl: "https://puschelz.de",
      apiToken: "pz_legacy",
      wowPath: "D:/Games/World of Warcraft",
    });

    const stableConfigPath = path.join(appDataDir, "Puschelz Client", "config.json");
    expect(fs.existsSync(stableConfigPath)).toBe(true);

    const stableContents = JSON.parse(fs.readFileSync(stableConfigPath, "utf8"));
    expect(stableContents.apiToken).toBe("pz_legacy");
  });
});
