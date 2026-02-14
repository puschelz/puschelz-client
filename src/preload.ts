import { contextBridge, ipcRenderer } from "electron";
import type { SyncConfig, SyncStatus } from "./lib/types";

type RendererState = {
  config: SyncConfig;
  status: SyncStatus;
};

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
      saveConfig: (config: SyncConfig) => Promise<ActionResult>;
      pickWowPath: () => Promise<string | null>;
      syncNow: () => Promise<ActionResult>;
      onStatus: (listener: (status: SyncStatus) => void) => () => void;
    };
  }
}
