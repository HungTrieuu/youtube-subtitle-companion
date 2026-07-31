import { app } from "electron";

import { formatHotkeyLabel } from "../../common/hotkey-label";
import type { AppContext } from "../app-context";
import {
  applyAutoStartPreference,
  clampFont,
  quitApplication,
  refreshHotkeys,
  setOverlayActive,
  setOverlayVisible,
  showSavedWordsWindow,
  updateConfig
} from "../actions/app-actions";
import { createAppContext } from "./create-app-context";
import { logger } from "../logger";
import { registerIpcHandlers } from "../ipc/register-ipc-handlers";
import { emitRuntimeState, syncRuntimeState } from "../state/sync-runtime-state";
import { writeDesktopProcessState } from "../runtime-state";
import { prepareForQuit, shutdownAppContext } from "./shutdown";
import { TrayController } from "../tray";

const createTrayController = (context: AppContext): TrayController => {
  const state = context.runtimeStore.getState();

  return new TrayController(
    {
      showOverlay: () => {
        setOverlayVisible(context, true);
      },
      hideOverlay: () => {
        setOverlayVisible(context, false);
      },
      setOverlayActive: (enabled) => {
        setOverlayActive(context, enabled);
      },
      openSavedWords: () => {
        void showSavedWordsWindow(context);
      },
      increaseFont: () => {
        updateConfig(context, {
          fontSize: clampFont(context.runtimeStore.getState().config.fontSize + 2)
        });
      },
      decreaseFont: () => {
        updateConfig(context, {
          fontSize: clampFont(context.runtimeStore.getState().config.fontSize - 2)
        });
      },
      setAutoStart: (enabled) => {
        updateConfig(context, {
          autoStart: enabled
        });
      },
      reconnectExtension: () => {
        context.websocketServer.reconnectAll();
      },
      quit: () => {
        quitApplication(context);
      }
    },
    {
      overlayVisible: state.config.overlayVisible,
      overlayMode: state.overlay.mode,
      activeOverlayHotkeyLabel: formatHotkeyLabel(state.config.hotkeys.toggleInteraction),
      moveOverlayHotkeyLabel: formatHotkeyLabel(state.config.hotkeys.moveOverlay),
      autoStart: state.config.autoStart,
      connected: state.connection.connected
    }
  );
};

const handleShutdownSignal = (context: AppContext | null, signal: NodeJS.Signals): void => {
  logger.debug("bootstrap", `Received ${signal}, shutting down desktop app`);

  if (context) {
    prepareForQuit(context);
  }

  app.quit();
};

export const bootstrapDesktopApp = async (): Promise<void> => {
  let context: AppContext | null = null;

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  process.once("SIGINT", () => {
    handleShutdownSignal(context, "SIGINT");
  });
  process.once("SIGTERM", () => {
    handleShutdownSignal(context, "SIGTERM");
  });

  app.on("second-instance", () => {
    if (!context) {
      return;
    }

    setOverlayVisible(context, true);
  });

  await app.whenReady();

  logger.debug("bootstrap", "Desktop app ready", {
    electron: process.versions.electron,
    sessionType: process.env.XDG_SESSION_TYPE ?? null,
    currentDesktop: process.env.XDG_CURRENT_DESKTOP ?? null,
    waylandDisplay: process.env.WAYLAND_DISPLAY ?? null,
    forceX11: process.platform === "linux" && process.env.YSC_FORCE_WAYLAND !== "1",
    useWayland: process.env.YSC_FORCE_WAYLAND === "1"
  });

  await writeDesktopProcessState();

  context = createAppContext();
  registerIpcHandlers(context);
  await context.overlayWindow.load();

  context.trayController = createTrayController(context);
  context.session.runtimeSyncCleanup = syncRuntimeState(context);
  emitRuntimeState(context);

  await context.websocketServer.start();
  refreshHotkeys(context);
  applyAutoStartPreference(context.runtimeStore.getState().config.autoStart);

  app.on("before-quit", () => {
    if (!context) {
      return;
    }

    prepareForQuit(context);
    void shutdownAppContext(context);
  });

  app.on("window-all-closed", () => {
    if (context?.session.isQuitting) {
      return;
    }
  });
};
