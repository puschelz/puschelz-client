import type { SyncConfig, SyncStatus } from "../lib/types";

const endpointInput = document.getElementById("endpointUrl") as HTMLInputElement;
const tokenInput = document.getElementById("apiToken") as HTMLInputElement;
const wowPathInput = document.getElementById("wowPath") as HTMLInputElement;
const statusNode = document.getElementById("status") as HTMLDivElement;
const watchNode = document.getElementById("watchedFile") as HTMLDivElement;
const lastSyncedNode = document.getElementById("lastSyncedAt") as HTMLDivElement;
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
  lastSyncedNode.textContent = `Last synced: ${formatTimestamp(status.lastSyncedAt)}`;
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
  await window.puschelz.saveConfig(readConfigFromForm());
});

browseButton.addEventListener("click", async () => {
  const picked = await window.puschelz.pickWowPath();
  if (picked) {
    wowPathInput.value = picked;
  }
});

syncButton.addEventListener("click", async () => {
  await window.puschelz.syncNow();
});

void init();
