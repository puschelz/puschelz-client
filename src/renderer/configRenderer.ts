type SyncConfig = {
  endpointUrl: string;
  apiToken: string;
  wowPath: string;
};

type SyncStatus = {
  state: "idle" | "watching" | "syncing" | "error";
  detail: string;
  lastSyncedAt: number | null;
  watchedFile: string | null;
};

type UpdateStatus = {
  enabled: boolean;
  currentVersion: string;
  availableVersion: string | null;
  state:
    | "unsupported"
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "error";
  detail: string;
  checkedAt: number | null;
  restartRequired: boolean;
};

const endpointInput = document.getElementById("endpointUrl") as HTMLInputElement;
const tokenInput = document.getElementById("apiToken") as HTMLInputElement;
const wowPathInput = document.getElementById("wowPath") as HTMLInputElement;
const currentVersionNode = document.getElementById("currentVersion") as HTMLSpanElement;
const latestVersionNode = document.getElementById("latestVersion") as HTMLSpanElement;
const updateBannerNode = document.getElementById("updateBanner") as HTMLDivElement;
const statusNode = document.getElementById("status") as HTMLDivElement;
const watchNode = document.getElementById("watchedFile") as HTMLDivElement;
const lastSyncedNode = document.getElementById("lastSyncedAt") as HTMLDivElement;
const actionFeedbackNode = document.getElementById("actionFeedback") as HTMLDivElement;
const saveButton = document.getElementById("saveConfig") as HTMLButtonElement;
const browseButton = document.getElementById("browsePath") as HTMLButtonElement;
const syncButton = document.getElementById("syncNow") as HTMLButtonElement;
const restartToUpdateButton = document.getElementById("restartToUpdate") as HTMLButtonElement;

type ActionResult = {
  ok: boolean;
  message: string;
};

type PuschelzBridge = {
  loadState: () => Promise<{ config: SyncConfig; status: SyncStatus; updateStatus: UpdateStatus }>;
  saveConfig: (config: SyncConfig) => Promise<ActionResult>;
  pickWowPath: () => Promise<string | null>;
  syncNow: () => Promise<ActionResult>;
  restartToUpdate: () => Promise<ActionResult>;
  onStatus: (listener: (status: SyncStatus) => void) => () => void;
  onUpdateStatus: (listener: (status: UpdateStatus) => void) => () => void;
};

function formatTimestamp(timestamp: number | null): string {
  if (!timestamp) {
    return "Never";
  }

  return new Date(timestamp).toLocaleString();
}

function renderStatus(status: SyncStatus): void {
  statusNode.textContent = `State: ${status.state} - ${status.detail}`;
  watchNode.textContent = `Watching: ${status.watchedFile ?? "Not configured"}`;
  lastSyncedNode.textContent = `Last successful sync: ${formatTimestamp(status.lastSyncedAt)}`;
}

function renderUpdateStatus(status: UpdateStatus): void {
  currentVersionNode.textContent = `v${status.currentVersion}`;
  latestVersionNode.textContent = status.availableVersion ? `v${status.availableVersion}` : "-";

  const bannerKind =
    status.state === "downloaded"
      ? "ready"
      : status.state === "error"
        ? "error"
        : status.state === "available" || status.state === "downloading" || status.state === "checking"
          ? status.state
          : "info";

  if (status.state === "unsupported" || (!status.enabled && status.state === "idle")) {
    updateBannerNode.style.display = "none";
  } else if (status.state === "idle") {
    updateBannerNode.style.display = "none";
  } else {
    updateBannerNode.style.display = "block";
  }

  updateBannerNode.dataset.kind = bannerKind;
  updateBannerNode.textContent = status.detail;
  restartToUpdateButton.style.display = status.restartRequired ? "" : "none";
}

function setActionFeedback(kind: "info" | "success" | "error", message: string): void {
  actionFeedbackNode.dataset.kind = kind;
  actionFeedbackNode.textContent = message;
}

function setButtonsDisabled(disabled: boolean): void {
  saveButton.disabled = disabled;
  browseButton.disabled = disabled;
  syncButton.disabled = disabled;
  restartToUpdateButton.disabled = disabled;
}

function bridge(): PuschelzBridge | null {
  const candidate = (window as Window & { puschelz?: PuschelzBridge }).puschelz;
  if (!candidate) {
    return null;
  }
  return candidate;
}

function readConfigFromForm(): SyncConfig {
  return {
    endpointUrl: endpointInput.value.trim(),
    apiToken: tokenInput.value.trim(),
    wowPath: wowPathInput.value.trim(),
  };
}

async function init(): Promise<void> {
  const api = bridge();
  if (!api) {
    setButtonsDisabled(true);
    setActionFeedback(
      "error",
      "Client bridge is unavailable. Please restart the app (settings window is disconnected)."
    );
    return;
  }

  const state = await api.loadState();
  endpointInput.value = state.config.endpointUrl;
  tokenInput.value = state.config.apiToken;
  wowPathInput.value = state.config.wowPath;
  renderStatus(state.status);
  renderUpdateStatus(state.updateStatus);
  setActionFeedback("info", "Ready.");

  api.onStatus(renderStatus);
  api.onUpdateStatus(renderUpdateStatus);
}

saveButton.addEventListener("click", async () => {
  const api = bridge();
  if (!api) {
    setActionFeedback("error", "Save failed: client bridge unavailable.");
    return;
  }

  setButtonsDisabled(true);
  setActionFeedback("info", "Saving settings...");
  try {
    const result = await api.saveConfig(readConfigFromForm());
    setActionFeedback(result.ok ? "success" : "error", result.message);
  } catch (error) {
    setActionFeedback("error", `Save failed: ${String(error)}`);
  } finally {
    setButtonsDisabled(false);
  }
});

browseButton.addEventListener("click", async () => {
  const api = bridge();
  if (!api) {
    setActionFeedback("error", "Browse failed: client bridge unavailable.");
    return;
  }

  setButtonsDisabled(true);
  setActionFeedback("info", "Opening file picker...");
  try {
    const picked = await api.pickWowPath();
    if (picked) {
      wowPathInput.value = picked;
      setActionFeedback("success", `Selected path: ${picked}`);
    } else {
      setActionFeedback("info", "No path selected.");
    }
  } catch (error) {
    setActionFeedback("error", `Browse failed: ${String(error)}`);
  } finally {
    setButtonsDisabled(false);
  }
});

syncButton.addEventListener("click", async () => {
  const api = bridge();
  if (!api) {
    setActionFeedback("error", "Sync failed: client bridge unavailable.");
    return;
  }

  setButtonsDisabled(true);
  setActionFeedback("info", "Running manual sync...");
  try {
    const result = await api.syncNow();
    setActionFeedback(result.ok ? "success" : "error", result.message);
  } catch (error) {
    setActionFeedback("error", `Sync failed: ${String(error)}`);
  } finally {
    setButtonsDisabled(false);
  }
});

restartToUpdateButton.addEventListener("click", async () => {
  const api = bridge();
  if (!api) {
    setActionFeedback("error", "Update restart failed: client bridge unavailable.");
    return;
  }

  setButtonsDisabled(true);
  setActionFeedback("info", "Restarting to install update...");
  try {
    const result = await api.restartToUpdate();
    setActionFeedback(result.ok ? "success" : "error", result.message);
  } catch (error) {
    setActionFeedback("error", `Update restart failed: ${String(error)}`);
  } finally {
    setButtonsDisabled(false);
  }
});

window.addEventListener("error", (event) => {
  setActionFeedback("error", `UI runtime error: ${event.message}`);
});

window.addEventListener("unhandledrejection", (event) => {
  setActionFeedback("error", `UI promise error: ${String(event.reason)}`);
});

void init();
