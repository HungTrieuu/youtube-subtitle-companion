import { BrowserWindow, screen } from "electron";
import path from "node:path";
import { setTimeout } from "node:timers";

import type {
  PlayerStateMessage,
  SubtitleUpdateMessage
} from "@youtube-subtitle-companion/shared";

import { IPC_CHANNELS } from "../common/ipc";
import type { AppConfig, OverlayConnectionState } from "../common/types";
import { logger } from "./logger";

type OverlayWindowOptions = {
  initialConfig: AppConfig;
  onBoundsChanged(bounds: Pick<AppConfig, "width" | "height" | "x" | "y">): void;
};

const HIDDEN_OVERLAY_SIZE = 1;

const defaultBounds = (config: AppConfig) => {
  const workArea = screen.getPrimaryDisplay().workArea;

  return {
    width: config.width,
    height: config.height,
    x: config.x ?? Math.round(workArea.x + (workArea.width - config.width) / 2),
    y: config.y ?? Math.round(workArea.y + workArea.height - config.height - 72)
  };
};

export class OverlayWindowController {
  private readonly window: BrowserWindow;
  private currentConfig: AppConfig;
  private isQuitting = false;
  private moveOverlayModeActive = false;

  public constructor(private readonly options: OverlayWindowOptions) {
    this.currentConfig = options.initialConfig;

    const bounds = defaultBounds(options.initialConfig);

    this.window = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      hasShadow: false,
      fullscreenable: false,
      show: false,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: path.join(__dirname, "../preload/preload.js"),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.window.setAlwaysOnTop(true, "screen-saver");
    this.window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    });

    this.window.on("close", (event) => {
      if (this.isQuitting) {
        return;
      }

      event.preventDefault();
      this.window.hide();
    });

    this.window.on("move", () => {
      this.persistBounds();
    });

    this.window.on("resize", () => {
      this.persistBounds();
    });

    this.window.on("blur", () => {
      this.deactivateMoveOverlayMode();
    });

    this.window.webContents.on("before-input-event", (_event, input) => {
      if (!this.moveOverlayModeActive || input.type !== "keyDown") {
        return;
      }

      if (input.key.toLowerCase() === "escape") {
        this.deactivateMoveOverlayMode();
      }
    });

    this.applyWindowInteraction();
  }

  public async load(): Promise<void> {
    await this.window.loadFile(path.join(__dirname, "../renderer/index.html"));

    if (this.options.initialConfig.overlayVisible) {
      this.reveal(false);
    }
  }

  public getBrowserWindow(): BrowserWindow {
    return this.window;
  }

  public setQuitting(value: boolean): void {
    this.isQuitting = value;
  }

  public applyConfig(config: AppConfig): void {
    this.currentConfig = config;

    if (!config.overlayVisible) {
      this.moveOverlayModeActive = false;
    }

    const bounds = this.window.getBounds();
    const nextBounds = {
      width: config.overlayVisible ? config.width : HIDDEN_OVERLAY_SIZE,
      height: config.overlayVisible ? config.height : HIDDEN_OVERLAY_SIZE,
      x: config.x ?? bounds.x,
      y: config.y ?? bounds.y
    };

    this.window.setBounds(nextBounds);
    this.applyWindowInteraction();
    this.window.showInactive();

    if (config.overlayVisible) {
      this.reveal(false);
    }
  }

  public show(): void {
    this.reveal(true);
  }

  public hide(): void {
    this.window.hide();
  }

  public toggleMoveOverlayMode(): void {
    if (!this.currentConfig.overlayVisible) {
      return;
    }

    if (this.moveOverlayModeActive) {
      this.deactivateMoveOverlayMode();
      return;
    }

    this.moveOverlayModeActive = true;
    this.applyWindowInteraction();
    this.sendConfig();
    this.reveal(true);
    logger.debug("overlay", "Move overlay mode enabled");
  }

  public sendSubtitle(subtitle: SubtitleUpdateMessage | null): void {
    this.window.webContents.send(IPC_CHANNELS.subtitleUpdated, subtitle);
  }

  public sendPlayerState(playerState: PlayerStateMessage | null): void {
    this.window.webContents.send(IPC_CHANNELS.playerStateUpdated, playerState);
  }

  public sendConnection(connection: OverlayConnectionState): void {
    this.window.webContents.send(IPC_CHANNELS.connectionUpdated, connection);
  }

  public sendConfig(): void {
    this.window.webContents.send(IPC_CHANNELS.configUpdated, this.getRenderedConfig());
  }

  public sendTemporaryDimState(active: boolean): void {
    this.window.webContents.send(IPC_CHANNELS.temporaryDimUpdated, active);
  }

  public getRenderedConfig(): AppConfig {
    if (!this.moveOverlayModeActive) {
      return this.currentConfig;
    }

    return {
      ...this.currentConfig,
      clickThrough: false
    };
  }

  private persistBounds(): void {
    if (!this.currentConfig.overlayVisible) {
      return;
    }

    const bounds = this.window.getBounds();
    this.options.onBoundsChanged({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y
    });
  }

  private applyWindowInteraction(): void {
    const clickThrough =
      !this.currentConfig.overlayVisible || !this.moveOverlayModeActive
        ? this.currentConfig.overlayVisible
          ? this.currentConfig.clickThrough
          : true
        : false;

    this.window.setIgnoreMouseEvents(clickThrough, {
      forward: true
    });
    this.window.setFocusable(this.currentConfig.overlayVisible && !clickThrough);
  }

  private deactivateMoveOverlayMode(): void {
    if (!this.moveOverlayModeActive) {
      return;
    }

    this.moveOverlayModeActive = false;
    this.applyWindowInteraction();
    this.sendConfig();
    this.window.blur();
    this.raiseToTop();
    logger.debug("overlay", "Move overlay mode disabled");
  }

  private raiseToTop(): void {
    this.window.setAlwaysOnTop(true, "screen-saver");

    try {
      this.window.moveTop();
    } catch (error) {
      logger.debug("overlay", "moveTop is unavailable on the current Linux windowing stack", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private reveal(activate: boolean): void {
    if (!this.currentConfig.overlayVisible) {
      return;
    }

    const restoreInteraction = !this.moveOverlayModeActive;

    this.window.setIgnoreMouseEvents(false, {
      forward: true
    });
    this.window.setFocusable(true);
    this.window.show();

    if (activate) {
      this.window.focus();
      this.window.webContents.focus();
    }

    this.raiseToTop();

    if (!restoreInteraction) {
      return;
    }

    setTimeout(() => {
      if (this.window.isDestroyed() || !this.currentConfig.overlayVisible || this.moveOverlayModeActive) {
        return;
      }

      this.applyWindowInteraction();
    }, 75);
  }
}
