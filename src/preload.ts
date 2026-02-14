import { contextBridge, ipcRenderer } from "electron";
import type { SyncConfig, SyncStatus } from "./lib/types";

type RendererState = {
  config: SyncConfig;
  status: SyncStatus;
};

contextBridge.exposeInMainWorld("puschelz", {
  loadState: async (): Promise<RendererState> => ipcRenderer.invoke("state:load"),
  saveConfig: async (config: SyncConfig): Promise<void> => ipcRenderer.invoke("config:save", config),
  pickWowPath: async (): Promise<string | null> => ipcRenderer.invoke("wowPath:pick"),
  syncNow: async (): Promise<void> => ipcRenderer.invoke("sync:now"),
  onStatus: (listener: (status: SyncStatus) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, status: SyncStatus) => listener(status);
    ipcRenderer.on("status:changed", wrapped);
    return () => ipcRenderer.off("status:changed", wrapped);
  },
});

declare global {
  interface Window {
    puschelz: {
      loadState: () => Promise<RendererState>;
      saveConfig: (config: SyncConfig) => Promise<void>;
      pickWowPath: () => Promise<string | null>;
      syncNow: () => Promise<void>;
      onStatus: (listener: (status: SyncStatus) => void) => () => void;
    };
  }
}
