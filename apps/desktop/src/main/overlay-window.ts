import { BrowserWindow, screen } from "electron";
import path from "node:path";
import { setTimeout } from "node:timers";

import type {
  PlayerStateMessage,
  SubtitleUpdateMessage
} from "@youtube-subtitle-companion/shared";

import { IPC_CHANNELS } from "../common/ipc";
import type { AppConfig, OverlayConnectionState, OverlayUiState } from "../common/types";
import { getAppIconPath } from "./app-icon";
import { logger } from "./logger";

type OverlayWindowOptions = {
  initialConfig: AppConfig;
  onBoundsChanged(bounds: Pick<AppConfig, "width" | "height" | "x" | "y">): void;
  onUiStateChanged(uiState: OverlayUiState): void;
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
  private interactionMode: OverlayUiState["mode"] = "click_through";
  private popupReservedTop = 0;
  private popupReservedBottom = 0;
  private suspendPersistBounds = false;

  public constructor(private readonly options: OverlayWindowOptions) {
    this.currentConfig = options.initialConfig;

    const bounds = defaultBounds(options.initialConfig);

    this.window = new BrowserWindow({
      ...bounds,
      icon: getAppIconPath(),
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
      if (this.interactionMode === "move") {
        this.setInteractionMode("click_through", {
          blurWindow: false,
          logMessage: "Move overlay mode disabled"
        });
      }
    });

    this.window.webContents.on("before-input-event", (_event, input) => {
      if (this.interactionMode !== "move" || input.type !== "keyDown") {
        return;
      }

      if (input.key.toLowerCase() === "escape") {
        this.setInteractionMode("click_through", {
          logMessage: "Move overlay mode disabled"
        });
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
      this.interactionMode = "click_through";
      this.popupReservedTop = 0;
      this.popupReservedBottom = 0;
    }

    const bounds = this.window.getBounds();
    const baseY = bounds.y + this.popupReservedTop;
    const nextBounds = {
      width: config.overlayVisible ? config.width : HIDDEN_OVERLAY_SIZE,
      height:
        config.overlayVisible
          ? config.height + this.popupReservedTop + this.popupReservedBottom
          : HIDDEN_OVERLAY_SIZE,
      x: config.x ?? bounds.x,
      y: config.overlayVisible ? (config.y ?? baseY) - this.popupReservedTop : bounds.y
    };

    this.suspendPersistBounds = true;
    this.window.setBounds(nextBounds);
    setTimeout(() => {
      this.suspendPersistBounds = false;
    }, 0);
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

    if (this.interactionMode === "move") {
      this.setInteractionMode("click_through", {
        logMessage: "Move overlay mode disabled"
      });
      return;
    }

    this.setInteractionMode("move", {
      focusWindow: true,
      logMessage: "Move overlay mode enabled"
    });
  }

  public setOverlayActive(active: boolean): void {
    if (!this.currentConfig.overlayVisible) {
      return;
    }

    this.setInteractionMode(active ? "active" : "click_through", {
      focusWindow: active,
      logMessage: active ? "Active overlay enabled" : "Active overlay disabled"
    });
  }

  public setPopupReservedSpace(topValue: number, bottomValue: number): void {
    const nextReservedTop = Math.max(0, Math.min(480, Math.round(topValue)));
    const nextReservedBottom = Math.max(0, Math.min(480, Math.round(bottomValue)));

    if (
      nextReservedTop === this.popupReservedTop &&
      nextReservedBottom === this.popupReservedBottom
    ) {
      return;
    }

    const bounds = this.window.getBounds();
    const baseY = bounds.y + this.popupReservedTop;
    const display = screen.getDisplayMatching(bounds);
    const workArea = display.workArea;

    this.popupReservedTop = nextReservedTop;
    this.popupReservedBottom = nextReservedBottom;

    if (!this.currentConfig.overlayVisible) {
      return;
    }

    let nextY = (this.currentConfig.y ?? baseY) - this.popupReservedTop;
    let nextHeight =
      this.currentConfig.height + this.popupReservedTop + this.popupReservedBottom;

    if (nextY < workArea.y) {
      const clampedOverflow = workArea.y - nextY;
      nextY = workArea.y;
      nextHeight = Math.max(this.currentConfig.height, nextHeight - clampedOverflow);
      this.popupReservedTop = Math.max(
        0,
        nextHeight - this.currentConfig.height - this.popupReservedBottom
      );
    }

    this.suspendPersistBounds = true;
    this.window.setBounds({
      width: this.currentConfig.width,
      height: nextHeight,
      x: this.currentConfig.x ?? bounds.x,
      y: nextY
    });
    setTimeout(() => {
      this.suspendPersistBounds = false;
    }, 0);
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

  public sendUiState(): void {
    this.options.onUiStateChanged(this.getUiState());
    this.window.webContents.send(IPC_CHANNELS.uiStateUpdated, this.getUiState());
  }

  public sendTemporaryDimState(active: boolean): void {
    this.window.webContents.send(IPC_CHANNELS.temporaryDimUpdated, active);
  }

  public getRenderedConfig(): AppConfig {
    return {
      ...this.currentConfig,
      clickThrough: this.interactionMode === "click_through"
    };
  }

  public getUiState(): OverlayUiState {
    return {
      mode: this.interactionMode
    };
  }

  private persistBounds(): void {
    if (!this.currentConfig.overlayVisible || this.suspendPersistBounds) {
      return;
    }

    const bounds = this.window.getBounds();
    this.options.onBoundsChanged({
      width: bounds.width,
      height: Math.max(
        80,
        bounds.height - this.popupReservedTop - this.popupReservedBottom
      ),
      x: bounds.x,
      y: bounds.y + this.popupReservedTop
    });
  }

  private applyWindowInteraction(): void {
    const clickThrough =
      !this.currentConfig.overlayVisible || this.interactionMode === "click_through";

    this.window.setIgnoreMouseEvents(clickThrough, {
      forward: true
    });
    this.window.setFocusable(this.currentConfig.overlayVisible && !clickThrough);
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

    const restoreInteraction = this.interactionMode === "click_through";

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
      if (
        this.window.isDestroyed() ||
        !this.currentConfig.overlayVisible ||
        this.interactionMode !== "click_through"
      ) {
        return;
      }

      this.applyWindowInteraction();
    }, 75);
  }

  private setInteractionMode(
    nextMode: OverlayUiState["mode"],
    options: {
      blurWindow?: boolean;
      focusWindow?: boolean;
      logMessage?: string;
    } = {}
  ): void {
    const {
      blurWindow = nextMode === "click_through",
      focusWindow = false,
      logMessage
    } = options;

    if (this.interactionMode === nextMode) {
      if (focusWindow) {
        this.reveal(true);
      }
      return;
    }

    this.interactionMode = nextMode;
    this.applyWindowInteraction();
    this.sendConfig();
    this.sendUiState();

    if (focusWindow) {
      this.reveal(true);
    } else if (blurWindow) {
      this.window.blur();
      this.raiseToTop();
    }

    if (logMessage) {
      logger.debug("overlay", logMessage);
    }
  }
}
