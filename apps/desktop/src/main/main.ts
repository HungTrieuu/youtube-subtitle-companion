import {
  app,
  BrowserWindow,
  Menu,
  globalShortcut,
  ipcMain,
  type MenuItemConstructorOptions
} from "electron";
import path from "node:path";

import {
  createSeekRelativeCommand,
  createToggleCommand,
  parseElectronMessage
} from "@youtube-subtitle-companion/shared";

import { formatHotkeyLabel } from "../common/hotkey-label";
import {
  IPC_CHANNELS,
  type OverlayContextMenuRequest,
  type OverlayPopupMetrics
} from "../common/ipc";
import type { DeleteLearningItemRequest, SaveLearningItemRequest } from "../common/learning";
import type { AppConfig, OverlayUiMode } from "../common/types";
import { DesktopConfigStore } from "./config-store";
import { DEFAULT_CONFIG } from "./config";
import { DictionaryService } from "./dictionary";
import { registerHotkeys } from "./hotkeys";
import { LearningStore } from "./learning-store";
import { logger } from "./logger";
import { OverlayWindowController } from "./overlay-window";
import { removeDesktopProcessState, writeDesktopProcessState } from "./runtime-state";
import { SavedWordsWindowController } from "./saved-words-window";
import { systemMediaController } from "./system-media";
import { TrayController } from "./tray";
import { LocalWebSocketServer } from "./websocket-server";

let overlayWindow: OverlayWindowController;
let configStore: DesktopConfigStore;
let trayController: TrayController;
let websocketServer: LocalWebSocketServer;
let dictionaryService: DictionaryService;
let learningStore: LearningStore;
let savedWordsWindow: SavedWordsWindowController | null = null;
let isQuitting = false;
let registeredHotkeysFingerprint: string | null = null;
let temporaryDimResetTimer: ReturnType<typeof setTimeout> | null = null;
const hotkeyCooldowns = new Map<string, number>();
const useWayland = process.env.YSC_FORCE_WAYLAND === "1";
const forceX11 = process.platform === "linux" && !useWayland;
const temporaryDimDurationMs = 2_000;
const seekHotkeyStepSeconds = 10;

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
const getOverlayMode = (): OverlayUiMode => overlayWindow.getUiState().mode;
const isSaveLearningItemRequest = (value: unknown): value is SaveLearningItemRequest =>
  Boolean(value) &&
  typeof value === "object" &&
  typeof (value as SaveLearningItemRequest).word === "string" &&
  typeof (value as SaveLearningItemRequest).sentence === "string" &&
  typeof (value as SaveLearningItemRequest).timestampMs === "number" &&
  ((value as SaveLearningItemRequest).videoId === null ||
    typeof (value as SaveLearningItemRequest).videoId === "string") &&
  ((value as SaveLearningItemRequest).videoTitle === null ||
    typeof (value as SaveLearningItemRequest).videoTitle === "string");
const isDeleteLearningItemRequest = (value: unknown): value is DeleteLearningItemRequest =>
  Boolean(value) &&
  typeof value === "object" &&
  typeof (value as DeleteLearningItemRequest).word === "string" &&
  typeof (value as DeleteLearningItemRequest).sentence === "string" &&
  typeof (value as DeleteLearningItemRequest).timestampMs === "number" &&
  typeof (value as DeleteLearningItemRequest).savedAt === "string" &&
  (value as DeleteLearningItemRequest).status === "new" &&
  ((value as DeleteLearningItemRequest).videoId === null ||
    typeof (value as DeleteLearningItemRequest).videoId === "string") &&
  ((value as DeleteLearningItemRequest).videoTitle === null ||
    typeof (value as DeleteLearningItemRequest).videoTitle === "string");
const isOverlayPopupMetrics = (value: unknown): value is OverlayPopupMetrics =>
  Boolean(value) &&
  typeof value === "object" &&
  typeof (value as OverlayPopupMetrics).visible === "boolean" &&
  typeof (value as OverlayPopupMetrics).reservedTop === "number" &&
  Number.isFinite((value as OverlayPopupMetrics).reservedTop) &&
  typeof (value as OverlayPopupMetrics).reservedBottom === "number" &&
  Number.isFinite((value as OverlayPopupMetrics).reservedBottom);

const handleShutdownSignal = (signal: NodeJS.Signals): void => {
  logger.debug("bootstrap", `Received ${signal}, shutting down desktop app`);
  isQuitting = true;

  if (overlayWindow) {
    overlayWindow.setQuitting(true);
  }

  app.quit();
};

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
    toggleSystemMedia: () => {
      runHotkeyAction("toggleSystemMedia", 250, () => {
        logger.debug("hotkeys", "Triggered toggleSystemMedia hotkey");
        void systemMediaController.togglePlayPause();
      });
    },
    seekBack: () => {
      logger.debug("hotkeys", "Triggered seekBack hotkey");
      void websocketServer.sendCommand(createSeekRelativeCommand(-seekHotkeyStepSeconds));
    },
    seekForward: () => {
      logger.debug("hotkeys", "Triggered seekForward hotkey");
      void websocketServer.sendCommand(createSeekRelativeCommand(seekHotkeyStepSeconds));
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
        setOverlayActive(getOverlayMode() !== "active");
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
  if (!trayController) {
    return;
  }

  trayController.update({
    overlayVisible: getConfig().overlayVisible,
    overlayMode: getOverlayMode(),
    activeOverlayHotkeyLabel: formatHotkeyLabel(getConfig().hotkeys.toggleInteraction),
    moveOverlayHotkeyLabel: formatHotkeyLabel(getConfig().hotkeys.moveOverlay),
    autoStart: getConfig().autoStart,
    connected: websocketServer.getConnectionState().connected
  });
};

const setOverlayActive = (active: boolean): void => {
  if (active && !getConfig().overlayVisible) {
    setOverlayVisible(true);
  }

  if (!getConfig().overlayVisible) {
    return;
  }

  overlayWindow.setOverlayActive(active);
  refreshTray();
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
  overlayWindow.sendUiState();
  setAutoStart(config.autoStart);
  refreshHotkeys();
  refreshTray();
  return config;
};

const notifyLearningItemsUpdated = (): void => {
  savedWordsWindow?.notifyItemsUpdated();
};

const showSavedWordsWindow = async (): Promise<void> => {
  if (savedWordsWindow === null) {
    savedWordsWindow = new SavedWordsWindowController({
      onClosed: () => {
        savedWordsWindow = null;
      }
    });
  }

  await savedWordsWindow.show();
};

const showContextMenu = (window: BrowserWindow, request: OverlayContextMenuRequest): void => {
  const current = getConfig();
  const overlayMode = getOverlayMode();
  const activeOverlayHotkeyLabel = formatHotkeyLabel(current.hotkeys.toggleInteraction);
  const moveOverlayHotkeyLabel = formatHotkeyLabel(current.hotkeys.moveOverlay);
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
      label: `Active overlay (${activeOverlayHotkeyLabel})`,
      type: "checkbox",
      checked: overlayMode === "active",
      click: () => {
        setOverlayActive(overlayMode !== "active");
      }
    },
    {
      label:
        overlayMode === "move"
          ? `Move mode is active (${moveOverlayHotkeyLabel})`
          : `Move overlay with ${moveOverlayHotkeyLabel}`,
      enabled: false
    },
    {
      type: "separator"
    },
    {
      label: "Saved words",
      click: () => {
        void showSavedWordsWindow();
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
    connection: websocketServer.getConnectionState(),
    uiState: overlayWindow.getUiState()
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

  ipcMain.on(IPC_CHANNELS.toggleOverlayActive, () => {
    setOverlayActive(getOverlayMode() !== "active");
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

  ipcMain.on(IPC_CHANNELS.setPopupMetrics, (_event, payload: unknown) => {
    if (!isOverlayPopupMetrics(payload)) {
      return;
    }

    overlayWindow.setPopupReservedSpace(
      payload.visible ? payload.reservedTop : 0,
      payload.visible ? payload.reservedBottom : 0
    );
  });

  ipcMain.handle(IPC_CHANNELS.lookupDictionary, (_event, payload: unknown) => {
    if (typeof payload !== "string") {
      return {
        success: false,
        code: "invalid_word" as const,
        error: "The selected token is invalid."
      };
    }

    return dictionaryService.lookup(payload);
  });

  ipcMain.handle(IPC_CHANNELS.saveLearningItem, (_event, payload: unknown) => {
    if (!isSaveLearningItemRequest(payload)) {
      return {
        success: false,
        error: "The learning item payload is invalid."
      };
    }

    return learningStore.save(payload).then((response) => {
      if (response.success && !response.duplicate) {
        notifyLearningItemsUpdated();
      }

      return response;
    });
  });

  ipcMain.handle(IPC_CHANNELS.getLearningItems, async () => {
    try {
      return {
        success: true,
        items: await learningStore.listItems()
      };
    } catch (error) {
      logger.error("learning", "Failed to list learning items", error);
      return {
        success: false,
        error: "Không thể tải danh sách từ đã lưu."
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.deleteLearningItem, (_event, payload: unknown) => {
    if (!isDeleteLearningItemRequest(payload)) {
      return {
        success: false,
        error: "The learning item payload is invalid."
      };
    }

    return learningStore.delete(payload).then((response) => {
      if (response.success && response.deleted) {
        notifyLearningItemsUpdated();
      }

      return response;
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
      setOverlayActive: (enabled) => {
        setOverlayActive(enabled);
      },
      openSavedWords: () => {
        void showSavedWordsWindow();
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
      overlayMode: getOverlayMode(),
      activeOverlayHotkeyLabel: formatHotkeyLabel(getConfig().hotkeys.toggleInteraction),
      moveOverlayHotkeyLabel: formatHotkeyLabel(getConfig().hotkeys.moveOverlay),
      autoStart: getConfig().autoStart,
      connected: false
    }
  );

const bootstrap = async (): Promise<void> => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  process.once("SIGINT", () => {
    handleShutdownSignal("SIGINT");
  });
  process.once("SIGTERM", () => {
    handleShutdownSignal("SIGTERM");
  });

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

  await writeDesktopProcessState();

  configStore = new DesktopConfigStore();
  dictionaryService = new DictionaryService();
  learningStore = new LearningStore(path.join(app.getPath("userData"), "learning-data"));
  const initialConfig = createLaunchConfig();
  configStore.setConfig(initialConfig);

  overlayWindow = new OverlayWindowController({
    initialConfig,
    onBoundsChanged: (bounds) => {
      configStore.updateConfig(bounds);
    },
    onUiStateChanged: () => {
      refreshTray();
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
  overlayWindow.sendUiState();
  overlayWindow.sendConnection(websocketServer.getConnectionState());
  overlayWindow.sendPlayerState(websocketServer.getActivePlayerState());
  overlayWindow.sendSubtitle(websocketServer.getActiveSubtitle());
  refreshTray();

  app.on("before-quit", () => {
    isQuitting = true;
    if (overlayWindow) {
      overlayWindow.setQuitting(true);
    }

    if (temporaryDimResetTimer !== null) {
      clearTimeout(temporaryDimResetTimer);
      temporaryDimResetTimer = null;
    }

    globalShortcut.unregisterAll();

    if (trayController) {
      trayController.destroy();
    }

    if (savedWordsWindow) {
      savedWordsWindow.destroy();
      savedWordsWindow = null;
    }

    if (websocketServer) {
      void websocketServer.stop().catch((error) => {
        logger.error("ws", "Failed to stop WebSocket server cleanly", error);
      });
    }

    void removeDesktopProcessState().catch((error) => {
      logger.warn("bootstrap", "Failed to remove desktop runtime state", error);
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
  void removeDesktopProcessState().catch((cleanupError) => {
    logger.warn("bootstrap", "Failed to remove desktop runtime state after bootstrap error", cleanupError);
  });
  app.quit();
});
