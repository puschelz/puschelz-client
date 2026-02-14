import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage } from "electron";
import type { OpenDialogOptions } from "electron";
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

type ActionResult = {
  ok: boolean;
  message: string;
};

function listMissingConfig(config: SyncConfig): string[] {
  const missing: string[] = [];
  if (!config.endpointUrl.trim()) {
    missing.push("endpoint URL");
  }
  if (!config.apiToken.trim()) {
    missing.push("API token");
  }
  if (!config.wowPath.trim()) {
    missing.push("WoW path");
  }
  return missing;
}

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
    { label: `Version: v${app.getVersion()}`, enabled: false },
    { type: "separator" },
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

async function startWatcher(): Promise<ActionResult> {
  const config = getConfig();
  const missing = listMissingConfig(config);
  if (missing.length > 0) {
    const missingText = missing.join(", ");
    setStatus({
      state: "idle",
      detail: `Missing required settings: ${missingText}`,
      watchedFile: null,
    });
    return {
      ok: true,
      message: `Saved. Missing required settings: ${missingText}.`,
    };
  }

  try {
    await addonWatcher.start(config, getCallbacks());
    return {
      ok: true,
      message: "Saved and watcher started successfully.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus({
      state: "error",
      detail: message,
      watchedFile: null,
    });
    return {
      ok: false,
      message: `Saved, but watcher failed to start: ${message}`,
    };
  }
}

async function runManualSync(): Promise<ActionResult> {
  const config = getConfig();
  const missing = listMissingConfig(config);
  if (missing.length > 0) {
    const missingText = missing.join(", ");
    const message = `Cannot sync. Missing required settings: ${missingText}.`;
    setStatus({
      state: "error",
      detail: message,
    });
    return {
      ok: false,
      message,
    };
  }

  try {
    await addonWatcher.syncNow(config, getCallbacks());
    return {
      ok: true,
      message: "Manual sync completed successfully.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus({
      state: "error",
      detail: message,
    });
    return {
      ok: false,
      message: `Manual sync failed: ${message}`,
    };
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

  const htmlPath = path.join(app.getAppPath(), "dist", "renderer", "config.html");
  void settingsWindow.loadFile(htmlPath);

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

async function pickWowPath(): Promise<string | null> {
  const dialogOptions: OpenDialogOptions = {
    properties: ["openDirectory", "openFile"],
    title: "Select WoW directory or direct Puschelz.lua path",
    buttonLabel: "Select",
  };
  const result = settingsWindow
    ? await dialog.showOpenDialog(settingsWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0] ?? null;
}

function registerIpcHandlers(): void {
  ipcMain.handle("state:load", async () => ({ config: getConfig(), status }));

  ipcMain.handle("config:save", async (_event, config: SyncConfig): Promise<ActionResult> => {
    configStore.saveConfig(config);
    return await startWatcher();
  });

  ipcMain.handle("wowPath:pick", async () => pickWowPath());

  ipcMain.handle("sync:now", async (): Promise<ActionResult> => {
    return await runManualSync();
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
