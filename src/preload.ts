import { contextBridge, ipcRenderer } from "electron";
import type { RendererState, SyncConfig, SyncStatus, UpdateStatus } from "./lib/types";

type ActionResult = {
  ok: boolean;
  message: string;
};

contextBridge.exposeInMainWorld("puschelz", {
  loadState: async (): Promise<RendererState> => ipcRenderer.invoke("state:load"),
  saveConfig: async (config: SyncConfig): Promise<ActionResult> =>
    ipcRenderer.invoke("config:save", config),
  pickWowPath: async (): Promise<string | null> => ipcRenderer.invoke("wowPath:pick"),
  syncNow: async (): Promise<ActionResult> => ipcRenderer.invoke("sync:now"),
  checkForUpdates: async (): Promise<ActionResult> => ipcRenderer.invoke("update:check"),
  restartToUpdate: async (): Promise<ActionResult> => ipcRenderer.invoke("update:restart"),
  openInstallFolder: async (): Promise<ActionResult> => ipcRenderer.invoke("app:openInstallFolder"),
  onStatus: (listener: (status: SyncStatus) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, status: SyncStatus) => listener(status);
    ipcRenderer.on("status:changed", wrapped);
    return () => ipcRenderer.off("status:changed", wrapped);
  },
  onUpdateStatus: (listener: (status: UpdateStatus) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => listener(status);
    ipcRenderer.on("update:changed", wrapped);
    return () => ipcRenderer.off("update:changed", wrapped);
  },
});

declare global {
  interface Window {
    puschelz: {
      loadState: () => Promise<RendererState>;
      saveConfig: (config: SyncConfig) => Promise<ActionResult>;
      pickWowPath: () => Promise<string | null>;
      syncNow: () => Promise<ActionResult>;
      checkForUpdates: () => Promise<ActionResult>;
      restartToUpdate: () => Promise<ActionResult>;
      openInstallFolder: () => Promise<ActionResult>;
      onStatus: (listener: (status: SyncStatus) => void) => () => void;
      onUpdateStatus: (listener: (status: UpdateStatus) => void) => () => void;
    };
  }
}
