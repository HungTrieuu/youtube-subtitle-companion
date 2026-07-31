import { app } from "electron";

import {
  createSeekRelativeCommand,
  createToggleCommand,
  type PlayerStateMessage,
  type SubtitleUpdateMessage
} from "@youtube-subtitle-companion/shared";

import type { AppConfig, AppConfigPatch, OverlayConnectionState, OverlayUiState } from "../../common/types";
import { DEFAULT_CONFIG } from "../config";
import { registerHotkeys } from "../hotkeys";
import { LearningStore } from "../learning-store";
import { logger } from "../logger";
import { SavedWordsWindowController } from "../saved-words-window";
import {
  deriveActiveSourceSummary,
  type DesktopRuntimeState
} from "../state/desktop-runtime-store";
import { systemMediaController } from "../system-media";
import type { AppContext } from "../app-context";

const temporaryDimDurationMs = 2_000;
const seekHotkeyStepSeconds = 5;

const updateRuntimeState = (
  context: AppContext,
  updater: (state: Readonly<DesktopRuntimeState>) => DesktopRuntimeState
): Readonly<DesktopRuntimeState> => context.runtimeStore.update(updater);

const runHotkeyAction = (context: AppContext, key: string, cooldownMs: number, action: () => void): void => {
  const now = Date.now();
  const lastTriggeredAt = context.session.hotkeyCooldowns.get(key) ?? 0;

  if (now - lastTriggeredAt < cooldownMs) {
    logger.debug("hotkeys", `Ignored repeated ${key} hotkey`, {
      cooldownMs
    });
    return;
  }

  context.session.hotkeyCooldowns.set(key, now);
  action();
};

export const applyAutoStartPreference = (enabled: boolean): void => {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled
    });
  } catch (error) {
    logger.warn("autostart", "Failed to update auto-start setting", error);
  }
};

export const clampFont = (fontSize: number): number => Math.min(64, Math.max(16, fontSize));

export const createLaunchConfig = (storedConfig: AppConfig): AppConfig => {
  if (!storedConfig.overlayVisible) {
    logger.debug("bootstrap", "Forcing overlay visible for an interactive desktop launch", {
      previousOverlayVisible: storedConfig.overlayVisible
    });
  }

  return {
    ...DEFAULT_CONFIG,
    ...storedConfig,
    overlayVisible: true
  };
};

export const setConnectionState = (
  context: AppContext,
  connection: OverlayConnectionState
): Readonly<DesktopRuntimeState> =>
  updateRuntimeState(context, (state) => ({
    ...state,
    connection,
    activeSource: deriveActiveSourceSummary(connection, state.player)
  }));

export const setPlayerState = (
  context: AppContext,
  player: PlayerStateMessage | null
): Readonly<DesktopRuntimeState> =>
  updateRuntimeState(context, (state) => ({
    ...state,
    player,
    activeSource: deriveActiveSourceSummary(state.connection, player)
  }));

export const setSubtitleState = (
  context: AppContext,
  subtitle: SubtitleUpdateMessage | null
): Readonly<DesktopRuntimeState> =>
  updateRuntimeState(context, (state) => ({
    ...state,
    subtitle
  }));

export const setOverlayUiState = (
  context: AppContext,
  overlay: OverlayUiState
): Readonly<DesktopRuntimeState> =>
  updateRuntimeState(context, (state) => {
    if (state.overlay.mode === overlay.mode) {
      return state as DesktopRuntimeState;
    }

    return {
      ...state,
      overlay
    };
  });

export const setTemporaryDimActive = (
  context: AppContext,
  active: boolean
): Readonly<DesktopRuntimeState> =>
  updateRuntimeState(context, (state) => {
    if (state.temporaryDimActive === active) {
      return state as DesktopRuntimeState;
    }

    return {
      ...state,
      temporaryDimActive: active
    };
  });

export const persistOverlayBounds = (
  context: AppContext,
  bounds: Pick<AppConfig, "width" | "height" | "x" | "y">
): AppConfig => {
  const nextConfig = context.configStore.updateConfig(bounds);

  updateRuntimeState(context, (state) => ({
    ...state,
    config: nextConfig
  }));

  return nextConfig;
};

export const refreshHotkeys = (context: AppContext): void => {
  const config = context.runtimeStore.getState().config;
  const fingerprint = JSON.stringify(config.hotkeys);

  if (context.session.registeredHotkeysFingerprint === fingerprint) {
    return;
  }

  registerHotkeys(config, {
    togglePlay: () => {
      logger.debug("hotkeys", "Triggered togglePlay hotkey");
      void context.websocketServer.sendCommand(createToggleCommand());
    },
    toggleSystemMedia: () => {
      runHotkeyAction(context, "toggleSystemMedia", 250, () => {
        logger.debug("hotkeys", "Triggered toggleSystemMedia hotkey");
        void systemMediaController.togglePlayPause();
      });
    },
    seekBack: () => {
      logger.debug("hotkeys", "Triggered seekBack hotkey");
      void context.websocketServer.sendCommand(createSeekRelativeCommand(-seekHotkeyStepSeconds));
    },
    seekForward: () => {
      logger.debug("hotkeys", "Triggered seekForward hotkey");
      void context.websocketServer.sendCommand(createSeekRelativeCommand(seekHotkeyStepSeconds));
    },
    toggleOverlay: () => {
      runHotkeyAction(context, "toggleOverlay", 250, () => {
        logger.debug("hotkeys", "Triggered toggleOverlay hotkey");
        setOverlayVisible(context, !context.runtimeStore.getState().config.overlayVisible);
      });
    },
    toggleInteraction: () => {
      runHotkeyAction(context, "toggleInteraction", 250, () => {
        logger.debug("hotkeys", "Triggered toggleInteraction hotkey");
        setOverlayActive(context, context.runtimeStore.getState().overlay.mode !== "active");
      });
    },
    moveOverlay: () => {
      runHotkeyAction(context, "moveOverlay", 250, () => {
        logger.debug("hotkeys", "Triggered moveOverlay hotkey");
        toggleMoveOverlayMode(context);
      });
    },
    temporaryDim: () => {
      logger.debug("hotkeys", "Triggered temporaryDim hotkey");
      setTemporaryDimActive(context, true);

      if (context.session.temporaryDimResetTimer !== null) {
        clearTimeout(context.session.temporaryDimResetTimer);
      }

      context.session.temporaryDimResetTimer = setTimeout(() => {
        context.session.temporaryDimResetTimer = null;
        setTemporaryDimActive(context, false);
      }, temporaryDimDurationMs);
    },
    increaseFont: () => {
      logger.debug("hotkeys", "Triggered increaseFont hotkey");
      updateConfig(context, {
        fontSize: clampFont(context.runtimeStore.getState().config.fontSize + 2)
      });
    },
    decreaseFont: () => {
      logger.debug("hotkeys", "Triggered decreaseFont hotkey");
      updateConfig(context, {
        fontSize: clampFont(context.runtimeStore.getState().config.fontSize - 2)
      });
    }
  });

  context.session.registeredHotkeysFingerprint = fingerprint;
};

export const updateConfig = (context: AppContext, patch: AppConfigPatch): AppConfig => {
  const nextConfig = context.configStore.updateConfig(patch);
  context.overlayWindow.applyConfig(nextConfig);

  updateRuntimeState(context, (state) => ({
    ...state,
    config: nextConfig,
    overlay: context.overlayWindow.getUiState()
  }));

  applyAutoStartPreference(nextConfig.autoStart);
  refreshHotkeys(context);
  return nextConfig;
};

export const setOverlayVisible = (context: AppContext, visible: boolean): AppConfig => {
  const current = context.runtimeStore.getState().config;

  if (current.overlayVisible === visible) {
    if (visible) {
      context.overlayWindow.show();
    }

    return current;
  }

  const config = updateConfig(context, {
    overlayVisible: visible
  });

  if (visible) {
    context.overlayWindow.show();
  }

  return config;
};

export const setOverlayActive = (context: AppContext, active: boolean): void => {
  if (active && !context.runtimeStore.getState().config.overlayVisible) {
    setOverlayVisible(context, true);
  }

  if (!context.runtimeStore.getState().config.overlayVisible) {
    return;
  }

  context.overlayWindow.setOverlayActive(active);
  setOverlayUiState(context, context.overlayWindow.getUiState());
};

export const toggleMoveOverlayMode = (context: AppContext): void => {
  context.overlayWindow.toggleMoveOverlayMode();
  setOverlayUiState(context, context.overlayWindow.getUiState());
};

export const notifyLearningItemsUpdated = (context: AppContext): void => {
  context.savedWordsWindow?.notifyItemsUpdated();
};

export const showSavedWordsWindow = async (context: AppContext): Promise<void> => {
  if (context.savedWordsWindow === null) {
    context.savedWordsWindow = new SavedWordsWindowController({
      onClosed: () => {
        context.savedWordsWindow = null;
      }
    });
  }

  await context.savedWordsWindow.show();
};

export const quitApplication = (context: AppContext): void => {
  context.session.isQuitting = true;
  context.overlayWindow.setQuitting(true);
  app.quit();
};

export const createLearningStore = (baseDir: string): LearningStore => new LearningStore(baseDir);
