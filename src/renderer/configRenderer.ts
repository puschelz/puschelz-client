import type { SyncConfig, SyncStatus } from "../lib/types";

const endpointInput = document.getElementById("endpointUrl") as HTMLInputElement;
const tokenInput = document.getElementById("apiToken") as HTMLInputElement;
const wowPathInput = document.getElementById("wowPath") as HTMLInputElement;
const statusNode = document.getElementById("status") as HTMLDivElement;
const watchNode = document.getElementById("watchedFile") as HTMLDivElement;
const lastSyncedNode = document.getElementById("lastSyncedAt") as HTMLDivElement;
const actionFeedbackNode = document.getElementById("actionFeedback") as HTMLDivElement;
const saveButton = document.getElementById("saveConfig") as HTMLButtonElement;
const browseButton = document.getElementById("browsePath") as HTMLButtonElement;
const syncButton = document.getElementById("syncNow") as HTMLButtonElement;

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

function setActionFeedback(kind: "info" | "success" | "error", message: string): void {
  actionFeedbackNode.dataset.kind = kind;
  actionFeedbackNode.textContent = message;
}

function setButtonsDisabled(disabled: boolean): void {
  saveButton.disabled = disabled;
  browseButton.disabled = disabled;
  syncButton.disabled = disabled;
}

function readConfigFromForm(): SyncConfig {
  return {
    endpointUrl: endpointInput.value.trim(),
    apiToken: tokenInput.value.trim(),
    wowPath: wowPathInput.value.trim(),
  };
}

async function init(): Promise<void> {
  const state = await window.puschelz.loadState();
  endpointInput.value = state.config.endpointUrl;
  tokenInput.value = state.config.apiToken;
  wowPathInput.value = state.config.wowPath;
  renderStatus(state.status);

  window.puschelz.onStatus(renderStatus);
}

saveButton.addEventListener("click", async () => {
  setButtonsDisabled(true);
  setActionFeedback("info", "Saving settings...");
  try {
    const result = await window.puschelz.saveConfig(readConfigFromForm());
    setActionFeedback(result.ok ? "success" : "error", result.message);
  } catch (error) {
    setActionFeedback("error", `Save failed: ${String(error)}`);
  } finally {
    setButtonsDisabled(false);
  }
});

browseButton.addEventListener("click", async () => {
  setButtonsDisabled(true);
  setActionFeedback("info", "Opening file picker...");
  try {
    const picked = await window.puschelz.pickWowPath();
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
  setButtonsDisabled(true);
  setActionFeedback("info", "Running manual sync...");
  try {
    const result = await window.puschelz.syncNow();
    setActionFeedback(result.ok ? "success" : "error", result.message);
  } catch (error) {
    setActionFeedback("error", `Sync failed: ${String(error)}`);
  } finally {
    setButtonsDisabled(false);
  }
});

void init();
