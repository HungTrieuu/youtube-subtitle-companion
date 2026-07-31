import { app } from "electron";
import path from "node:path";

import { DesktopConfigStore } from "../config-store";
import { DictionaryService } from "../dictionary";
import { OverlayWindowController } from "../overlay-window";
import {
  createInitialDesktopRuntimeState,
  DesktopRuntimeStore
} from "../state/desktop-runtime-store";
import { LocalWebSocketServer } from "../websocket-server";
import type { AppContext } from "../app-context";
import {
  createLaunchConfig,
  createLearningStore,
  persistOverlayBounds,
  setConnectionState,
  setOverlayUiState,
  setPlayerState,
  setSubtitleState
} from "../actions/app-actions";

export const createAppContext = (): AppContext => {
  const configStore = new DesktopConfigStore();
  const initialConfig = createLaunchConfig(configStore.getConfig());
  configStore.setConfig(initialConfig);
  const runtimeStore = new DesktopRuntimeStore(createInitialDesktopRuntimeState(initialConfig));
  const dictionaryService = new DictionaryService();
  const learningStore = createLearningStore(path.join(app.getPath("userData"), "learning-data"));

  let context: AppContext;

  const overlayWindow = new OverlayWindowController({
    initialConfig,
    onBoundsChanged: (bounds) => {
      persistOverlayBounds(context, bounds);
    },
    onUiStateChanged: (uiState) => {
      setOverlayUiState(context, uiState);
    }
  });

  const websocketServer = new LocalWebSocketServer({
    onSubtitle: (subtitle) => {
      setSubtitleState(context, subtitle);
    },
    onPlayerState: (playerState) => {
      setPlayerState(context, playerState);
    },
    onConnection: (connection) => {
      setConnectionState(context, connection);
    }
  });

  context = {
    configStore,
    runtimeStore,
    overlayWindow,
    trayController: null,
    websocketServer,
    dictionaryService,
    learningStore,
    savedWordsWindow: null,
    session: {
      isQuitting: false,
      shutdownStarted: false,
      registeredHotkeysFingerprint: null,
      hotkeyCooldowns: new Map<string, number>(),
      temporaryDimResetTimer: null,
      runtimeSyncCleanup: null
    }
  };

  return context;
};
