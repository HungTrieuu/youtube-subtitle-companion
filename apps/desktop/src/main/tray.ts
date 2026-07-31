import { Menu, Tray, nativeImage } from "electron";

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

const createTrayIcon = () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
      <rect width="16" height="16" rx="4" fill="#0f172a" />
      <path d="M3 5.5a2.5 2.5 0 0 1 2.5-2.5h5A2.5 2.5 0 0 1 13 5.5v5A2.5 2.5 0 0 1 10.5 13h-5A2.5 2.5 0 0 1 3 10.5z" fill="#ef4444" />
      <path d="M6.5 5.5L10.5 8l-4 2.5z" fill="white" />
    </svg>
  `.trim();

  return nativeImage.createFromDataURL(`data:image/svg+xml,${encodeURIComponent(svg)}`);
};

export class TrayController {
  private readonly tray = new Tray(createTrayIcon());

  public constructor(
    private readonly handlers: TrayHandlers,
    private state: TrayState
  ) {
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
