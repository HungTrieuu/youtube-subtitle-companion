import { Menu, Tray, nativeImage } from "electron";

type TrayState = {
  overlayVisible: boolean;
  clickThrough: boolean;
  autoStart: boolean;
  connected: boolean;
};

type TrayHandlers = {
  showOverlay(): void;
  hideOverlay(): void;
  setClickThrough(enabled: boolean): void;
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
        label: "Interaction mode",
        type: "radio",
        checked: !this.state.clickThrough,
        click: () => this.handlers.setClickThrough(false)
      },
      {
        label: "Click-through mode",
        type: "radio",
        checked: this.state.clickThrough,
        click: () => this.handlers.setClickThrough(true)
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
