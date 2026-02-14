import chokidar, { type FSWatcher } from "chokidar";
import type { SyncConfig } from "./types";
import { resolveSavedVariablesFile } from "./pathResolver";
import { SyncService } from "./syncService";

export type WatchCallbacks = {
  onSyncStart: (detail: string) => void;
  onSyncSuccess: () => void;
  onError: (message: string) => void;
  onWatching: (filePath: string) => void;
};

export class AddonWatcher {
  private watcher: FSWatcher | null = null;
  private readonly syncService = new SyncService();
  private syncTimer: NodeJS.Timeout | null = null;
  private filePath: string | null = null;

  async start(config: SyncConfig, callbacks: WatchCallbacks): Promise<string> {
    await this.stop();

    const resolvedFile = await resolveSavedVariablesFile(config.wowPath);
    if (!resolvedFile) {
      throw new Error("Could not locate Puschelz.lua under the configured WoW path");
    }

    this.filePath = resolvedFile;
    callbacks.onWatching(resolvedFile);

    this.watcher = chokidar.watch(resolvedFile, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 800,
        pollInterval: 100,
      },
    });

    this.watcher.on("change", () => {
      this.scheduleSync(config, callbacks, "Detected SavedVariables change");
    });

    this.watcher.on("error", (error) => {
      callbacks.onError(`File watcher error: ${String(error)}`);
    });

    await this.runSync(config, callbacks, "Initial sync");
    return resolvedFile;
  }

  async stop(): Promise<void> {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.filePath = null;
  }

  async syncNow(config: SyncConfig, callbacks: WatchCallbacks): Promise<void> {
    if (!this.filePath) {
      const resolvedFile = await resolveSavedVariablesFile(config.wowPath);
      if (!resolvedFile) {
        throw new Error("Could not locate Puschelz.lua under the configured WoW path");
      }
      this.filePath = resolvedFile;
      callbacks.onWatching(resolvedFile);
    }

    await this.runSync(config, callbacks, "Manual sync");
  }

  private scheduleSync(config: SyncConfig, callbacks: WatchCallbacks, reason: string): void {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }

    this.syncTimer = setTimeout(() => {
      this.runSync(config, callbacks, reason).catch((error) => {
        callbacks.onError(String(error));
      });
    }, 500);
  }

  private async runSync(
    config: SyncConfig,
    callbacks: WatchCallbacks,
    reason: string
  ): Promise<void> {
    if (!this.filePath) {
      throw new Error("No SavedVariables file configured");
    }

    callbacks.onSyncStart(reason);

    try {
      await this.syncService.sync(this.filePath, config);
      callbacks.onSyncSuccess();
    } catch (error) {
      callbacks.onError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}
