import { Menu, Tray } from "electron";

import { getTrayIconPath } from "./app-icon";

type TrayState = {
  overlayVisible: boolean;
  overlayMode: "click_through" | "active" | "move";
  activeOverlayHotkeyLabel: string;
  moveOverlayHotkeyLabel: string;
  autoStart: boolean;
  connected: boolean;
};

type TrayHandlers = {
  showOverlay(): void;
  hideOverlay(): void;
  setOverlayActive(enabled: boolean): void;
  openSavedWords(): void;
  increaseFont(): void;
  decreaseFont(): void;
  setAutoStart(enabled: boolean): void;
  reconnectExtension(): void;
  quit(): void;
};

const createTrayIcon = (): string => getTrayIconPath();

export class TrayController {
  private readonly tray = new Tray(createTrayIcon());

  public constructor(
    private readonly handlers: TrayHandlers,
    private state: TrayState
  ) {
    this.tray.setImage(createTrayIcon());
    this.tray.setToolTip("YouTube Subtitle Companion");
    this.tray.on("click", () => {
      if (this.state.overlayVisible) {
        this.handlers.hideOverlay();
        return;
      }

      this.handlers.showOverlay();
    });
    this.refresh();
  }

  public update(state: TrayState): void {
    this.state = state;
    this.refresh();
  }

  public destroy(): void {
    this.tray.destroy();
  }

  private refresh(): void {
    const menu = Menu.buildFromTemplate([
      {
        label: "Show overlay",
        enabled: !this.state.overlayVisible,
        click: () => this.handlers.showOverlay()
      },
      {
        label: "Hide overlay",
        enabled: this.state.overlayVisible,
        click: () => this.handlers.hideOverlay()
      },
      {
        type: "separator"
      },
      {
        label: `Active overlay (${this.state.activeOverlayHotkeyLabel})`,
        type: "checkbox",
        checked: this.state.overlayMode === "active",
        click: () => this.handlers.setOverlayActive(this.state.overlayMode !== "active")
      },
      {
        label:
          this.state.overlayMode === "move"
            ? `Move mode is active (${this.state.moveOverlayHotkeyLabel})`
            : `Move overlay with ${this.state.moveOverlayHotkeyLabel}`,
        enabled: false
      },
      {
        type: "separator"
      },
      {
        label: "Saved words",
        click: () => this.handlers.openSavedWords()
      },
      {
        type: "separator"
      },
      {
        label: "Increase font",
        click: () => this.handlers.increaseFont()
      },
      {
        label: "Decrease font",
        click: () => this.handlers.decreaseFont()
      },
      {
        type: "separator"
      },
      {
        label: "Start with system",
        type: "checkbox",
        checked: this.state.autoStart,
        click: () => this.handlers.setAutoStart(!this.state.autoStart)
      },
      {
        label: "Reconnect extension",
        click: () => this.handlers.reconnectExtension()
      },
      {
        type: "separator"
      },
      {
        label: "Quit",
        click: () => this.handlers.quit()
      }
    ]);

    this.tray.setToolTip(
      this.state.connected
        ? "YouTube Subtitle Companion (extension connected)"
        : "YouTube Subtitle Companion (waiting for extension)"
    );
    this.tray.setContextMenu(menu);
  }
}
