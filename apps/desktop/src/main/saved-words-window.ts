import { BrowserWindow } from "electron";
import path from "node:path";

import { IPC_CHANNELS } from "../common/ipc";
import { getAppIconPath } from "./app-icon";

type SavedWordsWindowOptions = {
  onClosed(): void;
};

export class SavedWordsWindowController {
  private readonly window: BrowserWindow;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  public constructor(private readonly options: SavedWordsWindowOptions) {
    this.window = new BrowserWindow({
      width: 940,
      height: 720,
      minWidth: 720,
      minHeight: 520,
      icon: getAppIconPath(),
      show: false,
      autoHideMenuBar: true,
      title: "Saved Words",
      backgroundColor: "#f5f0e5",
      webPreferences: {
        preload: path.join(__dirname, "../preload/preload.js"),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.window.on("closed", () => {
      this.options.onClosed();
    });
  }

  public async show(): Promise<void> {
    if (!this.loaded) {
      if (this.loadPromise === null) {
        this.loadPromise = this.window
          .loadFile(path.join(__dirname, "../renderer/saved-words.html"))
          .then(() => {
            this.loaded = true;
          })
          .finally(() => {
            this.loadPromise = null;
          });
      }

      await this.loadPromise;
    } else {
      this.notifyItemsUpdated();
    }

    this.window.show();
    this.window.focus();
  }

  public notifyItemsUpdated(): void {
    if (!this.loaded || this.window.isDestroyed()) {
      return;
    }

    this.window.webContents.send(IPC_CHANNELS.learningItemsUpdated);
  }

  public destroy(): void {
    if (!this.window.isDestroyed()) {
      this.window.destroy();
    }
  }
}
