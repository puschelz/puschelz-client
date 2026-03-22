import path from "node:path";
import { app, autoUpdater, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage } from "electron";
import type { OpenDialogOptions } from "electron";
import { AddonWatcher } from "./lib/addonWatcher";
import { BridgeService } from "./lib/bridgeService";
import { ConfigStore } from "./lib/configStore";
import type { RendererState, SyncConfig, SyncStatus, UpdateStatus } from "./lib/types";
import { cleanupOldInstalledVersions } from "./lib/windowsAppCleanup";
import { detectWowInstallPath } from "./lib/wowPathDetection";
import { updateElectronApp, UpdateSourceType, type IUpdateInfo } from "update-electron-app";

const configStore = new ConfigStore();
const addonWatcher = new AddonWatcher();
const bridgeService = new BridgeService();
const BRIDGE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let tray: Tray | null = null;
let settingsWindow: BrowserWindow | null = null;
let bridgeRefreshTimer: NodeJS.Timeout | null = null;
let bridgeRefreshInFlight: Promise<void> | null = null;
let updateCheckConfigured = false;

let status: SyncStatus = {
  state: "idle",
  detail: "Waiting for configuration",
  lastSyncedAt: null,
  watchedFile: null,
};

let updateStatus: UpdateStatus = {
  enabled: false,
  currentVersion: app.getVersion(),
  availableVersion: null,
  state: "unsupported",
  detail: "Automatic updates are only available for installed Windows builds.",
  checkedAt: null,
  restartRequired: false,
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

function setUpdateStatus(next: Partial<UpdateStatus>): void {
  updateStatus = { ...updateStatus, ...next };
  refreshTrayMenu();
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("update:changed", updateStatus);
  }
}

function statusLabel(): string {
  if (status.lastSyncedAt) {
    return `${status.detail} (last synced ${new Date(status.lastSyncedAt).toLocaleTimeString()})`;
  }
  return status.detail;
}

function updateLabel(): string {
  if (updateStatus.state === "downloaded") {
    return updateStatus.availableVersion
      ? `Update ready: v${updateStatus.availableVersion}`
      : "Update ready";
  }

  if (updateStatus.state === "available" || updateStatus.state === "downloading") {
    return updateStatus.availableVersion
      ? `Updating to v${updateStatus.availableVersion}`
      : "Update available";
  }

  if (updateStatus.state === "checking") {
    return "Checking for updates";
  }

  if (updateStatus.state === "error") {
    return updateStatus.detail;
  }

  return `Version: v${updateStatus.currentVersion}`;
}

function refreshTrayMenu(): void {
  if (!tray) {
    return;
  }

  tray.setToolTip(`Puschelz: ${statusLabel()} | ${updateLabel()}`);

  const menu = Menu.buildFromTemplate([
    { label: `Version: v${app.getVersion()}`, enabled: false },
    { label: updateLabel(), enabled: false },
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
    ...(updateStatus.restartRequired
      ? [
          {
            label: "Restart to Update",
            click: () => {
              void restartToInstallUpdate();
            },
          } as const,
        ]
      : []),
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
        stopBridgeRefreshLoop();
        void addonWatcher.stop().finally(() => app.quit());
      },
    },
  ]);

  tray.setContextMenu(menu);
}

function isWindowsPackagedInstall(): boolean {
  return process.platform === "win32" && app.isPackaged;
}

function isSquirrelFirstRun(): boolean {
  return process.argv.includes("--squirrel-firstrun");
}

function versionFromUpdateInfo(info: IUpdateInfo): string | null {
  const releaseName = typeof info.releaseName === "string" ? info.releaseName.trim() : "";
  if (!releaseName) {
    return null;
  }

  const match = releaseName.match(/v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  return match?.[1] ?? releaseName;
}

async function restartToInstallUpdate(): Promise<ActionResult> {
  if (!updateStatus.restartRequired) {
    return {
      ok: false,
      message: "No downloaded update is ready to install.",
    };
  }

  stopBridgeRefreshLoop();
  try {
    await addonWatcher.stop();
  } catch {
    // Continue with updater install even if watcher shutdown is noisy.
  }

  autoUpdater.quitAndInstall();
  return {
    ok: true,
    message: "Restarting to install the downloaded update.",
  };
}

async function promptToInstallDownloadedUpdate(info: IUpdateInfo): Promise<void> {
  const availableVersion = versionFromUpdateInfo(info);
  setUpdateStatus({
    availableVersion,
    state: "downloaded",
    restartRequired: true,
    detail: availableVersion
      ? `Update v${availableVersion} is ready. Restart to install it.`
      : "A new update is ready. Restart to install it.",
    checkedAt: Date.now(),
  });

  const result = settingsWindow
    ? await dialog.showMessageBox(settingsWindow, {
        type: "info",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update Ready",
        message: availableVersion
          ? `Puschelz Client v${availableVersion} has been downloaded.`
          : "A new Puschelz Client update has been downloaded.",
        detail: "Restart the app now to install the update, or choose Later to keep working.",
      })
    : await dialog.showMessageBox({
        type: "info",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update Ready",
        message: availableVersion
          ? `Puschelz Client v${availableVersion} has been downloaded.`
          : "A new Puschelz Client update has been downloaded.",
        detail: "Restart the app now to install the update, or choose Later to keep working.",
      });

  if (result.response === 0) {
    await restartToInstallUpdate();
  }
}

function configureAutoUpdates(): void {
  if (updateCheckConfigured) {
    return;
  }

  if (!isWindowsPackagedInstall()) {
    setUpdateStatus({
      enabled: false,
      state: "unsupported",
      detail: app.isPackaged
        ? "Automatic updates are only enabled for Windows builds."
        : "Automatic updates are disabled in development builds.",
      checkedAt: null,
      restartRequired: false,
    });
    return;
  }

  if (isSquirrelFirstRun()) {
    setUpdateStatus({
      enabled: true,
      state: "idle",
      detail: "Update checks will start on the next launch after initial install.",
      checkedAt: null,
      restartRequired: false,
    });
    return;
  }

  updateCheckConfigured = true;
  setUpdateStatus({
    enabled: true,
    state: "idle",
    detail: "Waiting to check for updates.",
    checkedAt: null,
    restartRequired: false,
  });

  autoUpdater.on("checking-for-update", () => {
    setUpdateStatus({
      enabled: true,
      state: "checking",
      detail: "Checking for updates...",
      checkedAt: Date.now(),
      restartRequired: false,
    });
  });

  autoUpdater.on("update-available", () => {
    setUpdateStatus({
      enabled: true,
      state: "downloading",
      detail: "A new update is downloading in the background.",
      checkedAt: Date.now(),
      restartRequired: false,
    });
  });

  autoUpdater.on("update-not-available", () => {
    setUpdateStatus({
      enabled: true,
      availableVersion: null,
      state: "idle",
      detail: "You are up to date.",
      checkedAt: Date.now(),
      restartRequired: false,
    });
  });

  autoUpdater.on("error", (error) => {
    setUpdateStatus({
      enabled: true,
      state: "error",
      detail: `Update check failed: ${error instanceof Error ? error.message : String(error)}`,
      checkedAt: Date.now(),
      restartRequired: false,
    });
  });

  updateElectronApp({
    notifyUser: true,
    onNotifyUser: (info) => {
      void promptToInstallDownloadedUpdate(info);
    },
    updateSource: {
      type: UpdateSourceType.ElectronPublicUpdateService,
      repo: "puschelz/puschelz-client",
    },
  });
}

async function cleanupOldInstalledVersionsIfNeeded(): Promise<void> {
  if (!isWindowsPackagedInstall()) {
    return;
  }
  if (isSquirrelFirstRun()) {
    return;
  }

  try {
    const removedDirs = await cleanupOldInstalledVersions(process.execPath);
    if (removedDirs.length > 0) {
      console.info("Removed stale installed client versions.", removedDirs);
    }
  } catch (error) {
    console.warn("Failed to remove stale installed versions.", error);
  }
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

async function refreshBridgeData(options?: {
  skipIfBusy?: boolean;
  suppressErrorStatus?: boolean;
}): Promise<void> {
  if (bridgeRefreshInFlight) {
    if (options?.skipIfBusy) {
      return;
    }
    return await bridgeRefreshInFlight;
  }

  bridgeRefreshInFlight = (async () => {
    const config = getConfig();
    const missing = listMissingConfig(config);
    if (missing.length > 0) {
      return;
    }

    try {
      await bridgeService.refresh(config);
    } catch (error) {
      if (!options?.suppressErrorStatus) {
        setStatus({
          state: "error",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  })();

  try {
    await bridgeRefreshInFlight;
  } finally {
    bridgeRefreshInFlight = null;
  }
}

function stopBridgeRefreshLoop(): void {
  if (bridgeRefreshTimer) {
    clearInterval(bridgeRefreshTimer);
    bridgeRefreshTimer = null;
  }
}

function ensureBridgeRefreshLoop(): void {
  stopBridgeRefreshLoop();
  bridgeRefreshTimer = setInterval(() => {
    void refreshBridgeData({ skipIfBusy: true, suppressErrorStatus: true }).catch(() => {});
  }, BRIDGE_REFRESH_INTERVAL_MS);
}

async function startWatcher(): Promise<ActionResult> {
  const config = getConfig();
  const missing = listMissingConfig(config);
  if (missing.length > 0) {
    const missingText = missing.join(", ");
    stopBridgeRefreshLoop();
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
    let bridgeRefreshWarning: string | null = null;
    try {
      await refreshBridgeData({ suppressErrorStatus: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      bridgeRefreshWarning = `Watching SavedVariables (bridge refresh will retry: ${message})`;
    }
    ensureBridgeRefreshLoop();
    if (bridgeRefreshWarning) {
      setStatus({
        state: "watching",
        detail: bridgeRefreshWarning,
      });
    }
    return {
      ok: true,
      message: bridgeRefreshWarning
        ? "Saved and watcher started successfully. Bridge refresh will retry automatically."
        : "Saved and watcher started successfully.",
    };
  } catch (error) {
    stopBridgeRefreshLoop();
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
    let bridgeRefreshWarning: string | null = null;
    try {
      await refreshBridgeData({ suppressErrorStatus: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      bridgeRefreshWarning = `Manual sync completed, but bridge refresh will retry automatically: ${message}`;
    }
    return {
      ok: true,
      message: bridgeRefreshWarning ?? "Manual sync completed successfully.",
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
  ipcMain.handle("state:load", async (): Promise<RendererState> => ({
    config: getConfig(),
    status,
    updateStatus,
  }));

  ipcMain.handle("config:save", async (_event, config: SyncConfig): Promise<ActionResult> => {
    configStore.saveConfig(config);
    return await startWatcher();
  });

  ipcMain.handle("wowPath:pick", async () => pickWowPath());

  ipcMain.handle("sync:now", async (): Promise<ActionResult> => {
    return await runManualSync();
  });

  ipcMain.handle("update:restart", async (): Promise<ActionResult> => {
    return await restartToInstallUpdate();
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
  configureAutoUpdates();
  void cleanupOldInstalledVersionsIfNeeded();
  await startWatcher();
});

app.on("window-all-closed", () => {});

app.on("before-quit", () => {
  stopBridgeRefreshLoop();
  void addonWatcher.stop();
});
