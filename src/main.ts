import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage } from "electron";
import { AddonWatcher } from "./lib/addonWatcher";
import { ConfigStore } from "./lib/configStore";
import type { SyncConfig, SyncStatus } from "./lib/types";
import { detectWowInstallPath } from "./lib/wowPathDetection";

const configStore = new ConfigStore();
const addonWatcher = new AddonWatcher();

let tray: Tray | null = null;
let settingsWindow: BrowserWindow | null = null;

let status: SyncStatus = {
  state: "idle",
  detail: "Waiting for configuration",
  lastSyncedAt: null,
  watchedFile: null,
};

function getConfig(): SyncConfig {
  return configStore.getConfig();
}

function applyConfigDefaultsAndAutoDetection(): void {
  const config = getConfig();
  let changed = false;
  const nextConfig: SyncConfig = { ...config };

  if (!nextConfig.endpointUrl) {
    nextConfig.endpointUrl = "https://puschelz.de";
    changed = true;
  }

  if (!nextConfig.wowPath) {
    const detected = detectWowInstallPath();
    if (detected) {
      nextConfig.wowPath = detected;
      changed = true;
    }
  }

  if (changed) {
    configStore.saveConfig(nextConfig);
  }
}

function setStatus(next: Partial<SyncStatus>): void {
  status = { ...status, ...next };
  refreshTrayMenu();
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("status:changed", status);
  }
}

function statusLabel(): string {
  if (status.lastSyncedAt) {
    return `${status.detail} (last synced ${new Date(status.lastSyncedAt).toLocaleTimeString()})`;
  }
  return status.detail;
}

function refreshTrayMenu(): void {
  if (!tray) {
    return;
  }

  tray.setToolTip(`Puschelz: ${statusLabel()}`);

  const menu = Menu.buildFromTemplate([
    { label: `Status: ${status.state}`, enabled: false },
    { label: status.detail, enabled: false },
    {
      label: status.watchedFile ? `Watching: ${status.watchedFile}` : "Watching: Not configured",
      enabled: false,
    },
    {
      label: status.lastSyncedAt
        ? `Last synced: ${new Date(status.lastSyncedAt).toLocaleString()}`
        : "Last synced: Never",
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Open Settings",
      click: () => openSettingsWindow(),
    },
    {
      label: "Sync Now",
      click: () => {
        void runManualSync();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        void addonWatcher.stop().finally(() => app.quit());
      },
    },
  ]);

  tray.setContextMenu(menu);
}

function getCallbacks() {
  return {
    onSyncStart: (detail: string) => {
      setStatus({ state: "syncing", detail });
    },
    onSyncSuccess: () => {
      setStatus({
        state: "watching",
        detail: "Last synced just now",
        lastSyncedAt: Date.now(),
      });
    },
    onError: (message: string) => {
      setStatus({ state: "error", detail: message });
    },
    onWatching: (filePath: string) => {
      setStatus({ watchedFile: filePath, state: "watching", detail: "Watching SavedVariables" });
    },
  };
}

async function startWatcher(): Promise<void> {
  const config = getConfig();
  if (!config.endpointUrl || !config.apiToken || !config.wowPath) {
    setStatus({
      state: "idle",
      detail: "Configure endpoint URL, API token, and WoW path",
      watchedFile: null,
    });
    return;
  }

  try {
    await addonWatcher.start(config, getCallbacks());
  } catch (error) {
    setStatus({
      state: "error",
      detail: error instanceof Error ? error.message : String(error),
      watchedFile: null,
    });
  }
}

async function runManualSync(): Promise<void> {
  try {
    await addonWatcher.syncNow(getConfig(), getCallbacks());
  } catch (error) {
    setStatus({
      state: "error",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 780,
    height: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const htmlPath = path.join(app.getAppPath(), "src", "renderer", "config.html");
  void settingsWindow.loadFile(htmlPath);

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

async function pickWowPath(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "openFile"],
    title: "Select WoW directory or direct Puschelz.lua path",
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0] ?? null;
}

function registerIpcHandlers(): void {
  ipcMain.handle("state:load", async () => ({ config: getConfig(), status }));

  ipcMain.handle("config:save", async (_event, config: SyncConfig) => {
    configStore.saveConfig(config);
    await startWatcher();
  });

  ipcMain.handle("wowPath:pick", async () => pickWowPath());

  ipcMain.handle("sync:now", async () => {
    await runManualSync();
  });
}

function createTray(): void {
  const iconPath = path.join(app.getAppPath(), "assets", "tray-icon.png");
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  refreshTrayMenu();
  tray.on("double-click", () => openSettingsWindow());
}

app.whenReady().then(async () => {
  app.setAppUserModelId("com.puschelz.client");
  applyConfigDefaultsAndAutoDetection();
  createTray();
  registerIpcHandlers();
  await startWatcher();
});

app.on("window-all-closed", () => {});

app.on("before-quit", () => {
  void addonWatcher.stop();
});
