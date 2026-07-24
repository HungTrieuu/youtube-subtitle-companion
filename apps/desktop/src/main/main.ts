import {
  app,
  BrowserWindow,
  Menu,
  globalShortcut,
  ipcMain,
  type MenuItemConstructorOptions
} from "electron";

import {
  createSeekRelativeCommand,
  createToggleCommand,
  parseElectronMessage
} from "@youtube-subtitle-companion/shared";

import { IPC_CHANNELS, type OverlayContextMenuRequest } from "../common/ipc";
import type { AppConfig } from "../common/types";
import { DesktopConfigStore } from "./config-store";
import { DEFAULT_CONFIG } from "./config";
import { registerHotkeys } from "./hotkeys";
import { logger } from "./logger";
import { OverlayWindowController } from "./overlay-window";
import { TrayController } from "./tray";
import { LocalWebSocketServer } from "./websocket-server";

let overlayWindow: OverlayWindowController;
let configStore: DesktopConfigStore;
let trayController: TrayController;
let websocketServer: LocalWebSocketServer;
let isQuitting = false;
let registeredHotkeysFingerprint: string | null = null;
let temporaryDimResetTimer: ReturnType<typeof setTimeout> | null = null;
const hotkeyCooldowns = new Map<string, number>();
const useWayland = process.env.YSC_FORCE_WAYLAND === "1";
const forceX11 = process.platform === "linux" && !useWayland;
const temporaryDimDurationMs = 2_000;

if (process.platform === "linux") {
  if (forceX11) {
    app.commandLine.appendSwitch("ozone-platform", "x11");
  }

  // Electron globalShortcut often needs the portal path on Wayland/GNOME sessions.
  app.commandLine.appendSwitch(
    "enable-features",
    "GlobalShortcutsPortal,GlobalShortcutsPortalPreferredTrigger"
  );
}

const clampFont = (fontSize: number): number => Math.min(64, Math.max(16, fontSize));

const getConfig = (): AppConfig => configStore.getConfig();
const getHotkeyFingerprint = (config: AppConfig): string => JSON.stringify(config.hotkeys);

const runHotkeyAction = (key: string, cooldownMs: number, action: () => void): void => {
  const now = Date.now();
  const lastTriggeredAt = hotkeyCooldowns.get(key) ?? 0;

  if (now - lastTriggeredAt < cooldownMs) {
    logger.debug("hotkeys", `Ignored repeated ${key} hotkey`, {
      cooldownMs
    });
    return;
  }

  hotkeyCooldowns.set(key, now);
  action();
};

const createLaunchConfig = (): AppConfig => {
  const stored = getConfig();

  if (!stored.overlayVisible) {
    logger.debug("bootstrap", "Forcing overlay visible for an interactive desktop launch", {
      previousOverlayVisible: stored.overlayVisible
    });
  }

  return {
    ...DEFAULT_CONFIG,
    ...stored,
    overlayVisible: true
  };
};

const setAutoStart = (enabled: boolean): void => {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled
    });
  } catch (error) {
    logger.warn("autostart", "Failed to update auto-start setting", error);
  }
};

const refreshHotkeys = (): void => {
  const config = getConfig();
  const fingerprint = getHotkeyFingerprint(config);

  if (registeredHotkeysFingerprint === fingerprint) {
    return;
  }

  registerHotkeys(config, {
    togglePlay: () => {
      logger.debug("hotkeys", "Triggered togglePlay hotkey");
      void websocketServer.sendCommand(createToggleCommand());
    },
    seekBack: () => {
      logger.debug("hotkeys", "Triggered seekBack hotkey");
      void websocketServer.sendCommand(createSeekRelativeCommand(-5));
    },
    seekForward: () => {
      logger.debug("hotkeys", "Triggered seekForward hotkey");
      void websocketServer.sendCommand(createSeekRelativeCommand(5));
    },
    toggleOverlay: () => {
      runHotkeyAction("toggleOverlay", 250, () => {
        logger.debug("hotkeys", "Triggered toggleOverlay hotkey");
        setOverlayVisible(!getConfig().overlayVisible);
      });
    },
    toggleInteraction: () => {
      runHotkeyAction("toggleInteraction", 250, () => {
        logger.debug("hotkeys", "Triggered toggleInteraction hotkey");
        updateConfig({
          clickThrough: !getConfig().clickThrough
        });
      });
    },
    moveOverlay: () => {
      runHotkeyAction("moveOverlay", 250, () => {
        logger.debug("hotkeys", "Triggered moveOverlay hotkey");
        overlayWindow.toggleMoveOverlayMode();
      });
    },
    temporaryDim: () => {
      logger.debug("hotkeys", "Triggered temporaryDim hotkey");
      overlayWindow.sendTemporaryDimState(true);

      if (temporaryDimResetTimer !== null) {
        clearTimeout(temporaryDimResetTimer);
      }

      temporaryDimResetTimer = setTimeout(() => {
        temporaryDimResetTimer = null;
        overlayWindow.sendTemporaryDimState(false);
      }, temporaryDimDurationMs);
    },
    increaseFont: () => {
      logger.debug("hotkeys", "Triggered increaseFont hotkey");
      updateConfig({
        fontSize: clampFont(getConfig().fontSize + 2)
      });
    },
    decreaseFont: () => {
      logger.debug("hotkeys", "Triggered decreaseFont hotkey");
      updateConfig({
        fontSize: clampFont(getConfig().fontSize - 2)
      });
    }
  });

  registeredHotkeysFingerprint = fingerprint;
};

const refreshTray = (): void => {
  trayController.update({
    overlayVisible: getConfig().overlayVisible,
    clickThrough: getConfig().clickThrough,
    autoStart: getConfig().autoStart,
    connected: websocketServer.getConnectionState().connected
  });
};

const setOverlayVisible = (visible: boolean): AppConfig => {
  const current = getConfig();

  if (current.overlayVisible === visible) {
    if (visible) {
      overlayWindow.show();
    }

    return current;
  }

  const config = updateConfig({
    overlayVisible: visible
  });

  if (visible) {
    overlayWindow.show();
  }

  return config;
};

const updateConfig = (patch: Partial<AppConfig>): AppConfig => {
  const config = configStore.updateConfig(patch);
  overlayWindow.applyConfig(config);
  overlayWindow.sendConfig();
  setAutoStart(config.autoStart);
  refreshHotkeys();
  refreshTray();
  return config;
};

const showContextMenu = (window: BrowserWindow, request: OverlayContextMenuRequest): void => {
  const current = getConfig();
  const opacityOptions = [1, 0.85, 0.7];
  const alignmentOptions: AppConfig["alignment"][] = ["left", "center", "right"];

  const template: MenuItemConstructorOptions[] = [
    {
      label: current.overlayVisible ? "Hide overlay" : "Show overlay",
      click: () => {
        setOverlayVisible(!getConfig().overlayVisible);
      }
    },
    {
      label: "Interaction mode",
      type: "radio",
      checked: !current.clickThrough,
      click: () => {
        updateConfig({
          clickThrough: false
        });
      }
    },
    {
      label: "Click-through mode",
      type: "radio",
      checked: current.clickThrough,
      click: () => {
        updateConfig({
          clickThrough: true
        });
      }
    },
    {
      type: "separator"
    },
    {
      label: "Increase font",
      click: () => {
        updateConfig({
          fontSize: clampFont(getConfig().fontSize + 2)
        });
      }
    },
    {
      label: "Decrease font",
      click: () => {
        updateConfig({
          fontSize: clampFont(getConfig().fontSize - 2)
        });
      }
    },
    {
      type: "separator"
    },
    ...alignmentOptions.map((alignment) => ({
      label: `Align ${alignment}`,
      type: "radio" as const,
      checked: current.alignment === alignment,
      click: () => {
        updateConfig({
          alignment
        });
      }
    })),
    {
      type: "separator"
    },
    ...opacityOptions.map((opacity) => ({
      label: `Opacity ${Math.round(opacity * 100)}%`,
      type: "radio" as const,
      checked: current.opacity === opacity,
      click: () => {
        updateConfig({
          opacity
        });
      }
    }))
  ];

  const menu = Menu.buildFromTemplate(template);
  menu.popup({
    window,
    x: Math.round(request.x),
    y: Math.round(request.y)
  });
};

const registerIpc = (): void => {
  ipcMain.handle(IPC_CHANNELS.getInitialState, () => ({
    subtitle: websocketServer.getActiveSubtitle(),
    playerState: websocketServer.getActivePlayerState(),
    config: overlayWindow.getRenderedConfig(),
    connection: websocketServer.getConnectionState()
  }));

  ipcMain.on(IPC_CHANNELS.sendPlayerCommand, (_event, payload: unknown) => {
    const command = parseElectronMessage(payload);

    if (command === null) {
      logger.warn("ipc", "Rejected invalid renderer command", payload);
      return;
    }

    void websocketServer.sendCommand(command);
  });

  ipcMain.on(IPC_CHANNELS.toggleOverlay, () => {
    setOverlayVisible(!getConfig().overlayVisible);
  });

  ipcMain.on(IPC_CHANNELS.toggleInteraction, () => {
    updateConfig({
      clickThrough: !getConfig().clickThrough
    });
  });

  ipcMain.on(IPC_CHANNELS.adjustFont, (_event, delta: unknown) => {
    if (typeof delta !== "number" || !Number.isFinite(delta)) {
      return;
    }

    updateConfig({
      fontSize: clampFont(getConfig().fontSize + delta)
    });
  });

  ipcMain.handle(IPC_CHANNELS.openContextMenu, (event, payload: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);

    if (!window || !payload || typeof payload !== "object") {
      return;
    }

    const request = payload as Partial<OverlayContextMenuRequest>;
    if (
      typeof request.x !== "number" ||
      !Number.isFinite(request.x) ||
      typeof request.y !== "number" ||
      !Number.isFinite(request.y)
    ) {
      return;
    }

    showContextMenu(window, {
      x: request.x,
      y: request.y
    });
  });
};

const createTray = (): TrayController =>
  new TrayController(
    {
      showOverlay: () => {
        setOverlayVisible(true);
      },
      hideOverlay: () => {
        setOverlayVisible(false);
      },
      setClickThrough: (enabled) => {
        updateConfig({
          clickThrough: enabled
        });
      },
      increaseFont: () => {
        updateConfig({
          fontSize: clampFont(getConfig().fontSize + 2)
        });
      },
      decreaseFont: () => {
        updateConfig({
          fontSize: clampFont(getConfig().fontSize - 2)
        });
      },
      setAutoStart: (enabled) => {
        updateConfig({
          autoStart: enabled
        });
      },
      reconnectExtension: () => {
        websocketServer.reconnectAll();
      },
      quit: () => {
        isQuitting = true;
        overlayWindow.setQuitting(true);
        app.quit();
      }
    },
    {
      overlayVisible: getConfig().overlayVisible,
      clickThrough: getConfig().clickThrough,
      autoStart: getConfig().autoStart,
      connected: false
    }
  );

const bootstrap = async (): Promise<void> => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    if (!overlayWindow) {
      return;
    }

    setOverlayVisible(true);
  });

  await app.whenReady();

  logger.debug("bootstrap", "Desktop app ready", {
    electron: process.versions.electron,
    sessionType: process.env.XDG_SESSION_TYPE ?? null,
    currentDesktop: process.env.XDG_CURRENT_DESKTOP ?? null,
    waylandDisplay: process.env.WAYLAND_DISPLAY ?? null,
    forceX11,
    useWayland
  });

  configStore = new DesktopConfigStore();
  const initialConfig = createLaunchConfig();
  configStore.setConfig(initialConfig);

  overlayWindow = new OverlayWindowController({
    initialConfig,
    onBoundsChanged: (bounds) => {
      configStore.updateConfig(bounds);
    }
  });

  websocketServer = new LocalWebSocketServer({
    onSubtitle: (subtitle) => {
      overlayWindow.sendSubtitle(subtitle);
    },
    onPlayerState: (playerState) => {
      overlayWindow.sendPlayerState(playerState);
    },
    onConnection: (connection) => {
      overlayWindow.sendConnection(connection);
      refreshTray();
    }
  });

  registerIpc();
  await overlayWindow.load();

  trayController = createTray();
  await websocketServer.start();

  refreshHotkeys();
  setAutoStart(initialConfig.autoStart);

  overlayWindow.sendConfig();
  overlayWindow.sendConnection(websocketServer.getConnectionState());
  overlayWindow.sendPlayerState(websocketServer.getActivePlayerState());
  overlayWindow.sendSubtitle(websocketServer.getActiveSubtitle());
  refreshTray();

  app.on("before-quit", () => {
    isQuitting = true;
    overlayWindow.setQuitting(true);
    if (temporaryDimResetTimer !== null) {
      clearTimeout(temporaryDimResetTimer);
      temporaryDimResetTimer = null;
    }
    globalShortcut.unregisterAll();
    trayController.destroy();
    void websocketServer.stop().catch((error) => {
      logger.error("ws", "Failed to stop WebSocket server cleanly", error);
    });
  });

  app.on("window-all-closed", () => {
    if (isQuitting) {
      return;
    }
  });
};

void bootstrap().catch((error) => {
  logger.error("bootstrap", "Failed to start desktop app", error);
  app.quit();
});
