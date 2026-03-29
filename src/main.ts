import fs from "node:fs";
import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
} from "electron";
import type { OpenDialogOptions } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import { AddonWatcher } from "./lib/addonWatcher";
import { BridgeService } from "./lib/bridgeService";
import { ConfigStore } from "./lib/configStore";
import type { RendererState, SyncConfig, SyncStatus, UpdateStatus } from "./lib/types";
import { detectWowInstallPath } from "./lib/wowPathDetection";

const configStore = new ConfigStore();
const addonWatcher = new AddonWatcher();
const bridgeService = new BridgeService();
const BRIDGE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const AUTO_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let tray: Tray | null = null;
let settingsWindow: BrowserWindow | null = null;
let bridgeRefreshTimer: NodeJS.Timeout | null = null;
let bridgeRefreshInFlight: Promise<void> | null = null;
let autoUpdateTimer: NodeJS.Timeout | null = null;
let updateCheckConfigured = false;
let updateCheckInFlight: Promise<void> | null = null;
let pendingUserInitiatedUpdateCheck = false;
let updatePromptInFlight = false;

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
  showBannerWhenIdle: false,
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

function getInstallDirectory(): string {
  const executablePath = process.execPath;
  const executableDir = path.dirname(executablePath);
  const executableDirName = path.basename(executableDir);
  const installRoot = path.dirname(executableDir);

  if (
    process.platform === "win32" &&
    /^app-[^\\/]+$/i.test(executableDirName) &&
    fs.existsSync(path.join(installRoot, "Update.exe"))
  ) {
    return installRoot;
  }

  return executableDir;
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

function showNotification(title: string, body: string): void {
  if (!Notification.isSupported()) {
    return;
  }

  const notification = new Notification({
    title,
    body,
    silent: false,
  });
  notification.on("click", () => {
    openSettingsWindow();
  });
  notification.show();
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
    {
      label: "Open Settings",
      click: () => openSettingsWindow(),
    },
    {
      label: "Open Install Folder",
      click: () => {
        void openInstallFolder();
      },
    },
    {
      label: "Sync Now",
      click: () => {
        void runManualSync();
      },
    },
    {
      label: "Check for Updates",
      enabled:
        updateStatus.enabled && !updateStatus.restartRequired && updateStatus.state !== "checking",
      click: () => {
        void checkForUpdates({ userInitiated: true });
      },
    },
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
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        stopBridgeRefreshLoop();
        stopAutoUpdateLoop();
        void addonWatcher.stop().finally(() => app.quit());
      },
    },
  ]);

  tray.setContextMenu(menu);
}

function isWindowsPackagedInstall(): boolean {
  return process.platform === "win32" && app.isPackaged;
}

function versionFromUpdateInfo(info: UpdateInfo): string | null {
  return typeof info.version === "string" && info.version.trim() ? info.version.trim() : null;
}

function consumePendingUserInitiatedUpdateCheck(): boolean {
  const pending = pendingUserInitiatedUpdateCheck;
  pendingUserInitiatedUpdateCheck = false;
  return pending;
}

async function restartToInstallUpdate(): Promise<ActionResult> {
  if (!updateStatus.restartRequired) {
    return {
      ok: false,
      message: "No downloaded update is ready to install.",
    };
  }

  stopBridgeRefreshLoop();
  stopAutoUpdateLoop();
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

async function promptToInstallDownloadedUpdate(info: UpdateInfo): Promise<void> {
  if (updatePromptInFlight) {
    return;
  }

  updatePromptInFlight = true;
  try {
    const availableVersion = versionFromUpdateInfo(info);
    const message = availableVersion
      ? `Puschelz Client v${availableVersion} has been downloaded.`
      : "A new Puschelz Client update has been downloaded.";
    const updateDialogOptions = {
      type: "info" as const,
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update Ready",
      message,
      detail: "Restart the app now to install the update, or choose Later to keep working.",
    };

    setUpdateStatus({
      availableVersion,
      showBannerWhenIdle: false,
      state: "downloaded",
      restartRequired: true,
      detail: availableVersion
        ? `Update v${availableVersion} is ready. Restart to install it.`
        : "A new update is ready. Restart to install it.",
      checkedAt: Date.now(),
    });

    showNotification("Puschelz update ready", message);

    const result = settingsWindow
      ? await dialog.showMessageBox(settingsWindow, updateDialogOptions)
      : await dialog.showMessageBox(updateDialogOptions);

    if (result.response === 0) {
      await restartToInstallUpdate();
    }
  } finally {
    updatePromptInFlight = false;
  }
}

function stopAutoUpdateLoop(): void {
  if (autoUpdateTimer) {
    clearInterval(autoUpdateTimer);
    autoUpdateTimer = null;
  }
}

function ensureAutoUpdateLoop(): void {
  stopAutoUpdateLoop();
  autoUpdateTimer = setInterval(() => {
    void checkForUpdates({ userInitiated: false }).catch(() => {});
  }, AUTO_UPDATE_CHECK_INTERVAL_MS);
}

async function checkForUpdates(options: { userInitiated: boolean }): Promise<ActionResult> {
  if (updateStatus.restartRequired) {
    pendingUserInitiatedUpdateCheck = false;
    return {
      ok: false,
      message: "An update is already downloaded. Restart the app to install it.",
    };
  }

  if (!updateCheckConfigured) {
    return {
      ok: false,
      message: updateStatus.detail,
    };
  }

  if (updateCheckInFlight) {
    pendingUserInitiatedUpdateCheck = pendingUserInitiatedUpdateCheck || options.userInitiated;
    return {
      ok: true,
      message: "An update check is already in progress.",
    };
  }

  pendingUserInitiatedUpdateCheck = pendingUserInitiatedUpdateCheck || options.userInitiated;
  updateCheckInFlight = autoUpdater.checkForUpdates().then(() => undefined);

  try {
    await updateCheckInFlight;
    return {
      ok: true,
      message: options.userInitiated
        ? "Checking for updates..."
        : "Scheduled update check started.",
    };
  } catch (error) {
    return {
      ok: false,
      message: `Update check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    updateCheckInFlight = null;
  }
}

function configureAutoUpdates(): void {
  if (updateCheckConfigured) {
    return;
  }

  if (!isWindowsPackagedInstall()) {
    setUpdateStatus({
      enabled: false,
      showBannerWhenIdle: false,
      state: "unsupported",
      detail: app.isPackaged
        ? "Automatic updates are only enabled for Windows builds."
        : "Automatic updates are disabled in development builds.",
      checkedAt: null,
      restartRequired: false,
    });
    return;
  }

  updateCheckConfigured = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  setUpdateStatus({
    enabled: true,
    showBannerWhenIdle: false,
    state: "idle",
    detail: "Automatic update checks are enabled.",
    checkedAt: null,
    restartRequired: false,
  });

  autoUpdater.on("checking-for-update", () => {
    if (updateStatus.restartRequired) {
      return;
    }

    setUpdateStatus({
      enabled: true,
      showBannerWhenIdle: false,
      state: "checking",
      detail: "Checking for updates...",
      checkedAt: Date.now(),
    });
  });

  autoUpdater.on("update-available", (info) => {
    if (updateStatus.restartRequired) {
      return;
    }

    const availableVersion = versionFromUpdateInfo(info);
    setUpdateStatus({
      enabled: true,
      availableVersion,
      showBannerWhenIdle: false,
      state: "downloading",
      detail: availableVersion
        ? `Update v${availableVersion} is downloading in the background.`
        : "A new update is downloading in the background.",
      checkedAt: Date.now(),
    });

    showNotification(
      "Puschelz update found",
      availableVersion
        ? `Downloading v${availableVersion} in the background.`
        : "Downloading the latest update in the background."
    );
    consumePendingUserInitiatedUpdateCheck();
  });

  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    if (updateStatus.restartRequired) {
      return;
    }

    const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
    setUpdateStatus({
      enabled: true,
      state: "downloading",
      detail: updateStatus.availableVersion
        ? `Downloading update v${updateStatus.availableVersion} (${percent}%).`
        : `Downloading update (${percent}%).`,
      checkedAt: Date.now(),
    });
  });

  autoUpdater.on("update-not-available", () => {
    if (updateStatus.restartRequired) {
      return;
    }

    setUpdateStatus({
      enabled: true,
      availableVersion: null,
      showBannerWhenIdle: true,
      state: "idle",
      detail: "You are up to date.",
      checkedAt: Date.now(),
    });

    if (consumePendingUserInitiatedUpdateCheck()) {
      showNotification("Puschelz is up to date", "No new desktop client update is available.");
    }
  });

  autoUpdater.on("error", (error) => {
    if (updateStatus.restartRequired) {
      return;
    }

    const detail = `Update check failed: ${error instanceof Error ? error.message : String(error)}`;
    setUpdateStatus({
      enabled: true,
      showBannerWhenIdle: false,
      state: "error",
      detail,
      checkedAt: Date.now(),
    });

    if (consumePendingUserInitiatedUpdateCheck()) {
      showNotification("Puschelz update failed", detail);
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    stopAutoUpdateLoop();
    consumePendingUserInitiatedUpdateCheck();
    void promptToInstallDownloadedUpdate(info);
  });

  ensureAutoUpdateLoop();
  void checkForUpdates({ userInitiated: false }).catch(() => {});
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
    width: 860,
    height: 680,
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

async function openInstallFolder(): Promise<ActionResult> {
  const installDirectory = getInstallDirectory();
  const error = await shell.openPath(installDirectory);

  if (error) {
    return {
      ok: false,
      message: `Failed to open install folder: ${error}`,
    };
  }

  return {
    ok: true,
    message: `Opened install folder: ${installDirectory}`,
  };
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
    installDirectory: getInstallDirectory(),
  }));

  ipcMain.handle("config:save", async (_event, config: SyncConfig): Promise<ActionResult> => {
    configStore.saveConfig(config);
    return await startWatcher();
  });

  ipcMain.handle("wowPath:pick", async () => pickWowPath());

  ipcMain.handle("sync:now", async (): Promise<ActionResult> => {
    return await runManualSync();
  });

  ipcMain.handle("update:check", async (): Promise<ActionResult> => {
    return await checkForUpdates({ userInitiated: true });
  });

  ipcMain.handle("update:restart", async (): Promise<ActionResult> => {
    return await restartToInstallUpdate();
  });

  ipcMain.handle("app:openInstallFolder", async (): Promise<ActionResult> => {
    return await openInstallFolder();
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
  await startWatcher();
});

app.on("window-all-closed", () => {});

app.on("before-quit", () => {
  stopBridgeRefreshLoop();
  stopAutoUpdateLoop();
  void addonWatcher.stop();
});
