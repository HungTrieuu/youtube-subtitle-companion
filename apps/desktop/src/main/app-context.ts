import type {
  PlayerStateMessage,
  SubtitleUpdateMessage
} from "@youtube-subtitle-companion/shared";

import type { AppConfig, OverlayConnectionState, OverlayUiState } from "../common/types";
import type { DesktopConfigStore } from "./config-store";
import type { DictionaryService } from "./dictionary";
import type { LearningStore } from "./learning-store";
import type { OverlayWindowController } from "./overlay-window";
import type { SavedWordsWindowController } from "./saved-words-window";
import type { DesktopRuntimeStore } from "./state/desktop-runtime-store";
import type { TextToSpeechService } from "./tts-service";
import type { TrayController } from "./tray";
import type { LocalWebSocketServer } from "./websocket-server";

export type AppSessionState = {
  isQuitting: boolean;
  shutdownStarted: boolean;
  registeredHotkeysFingerprint: string | null;
  hotkeyCooldowns: Map<string, number>;
  temporaryDimResetTimer: ReturnType<typeof setTimeout> | null;
  runtimeSyncCleanup: (() => void) | null;
};

export type AppContext = {
  configStore: DesktopConfigStore;
  runtimeStore: DesktopRuntimeStore;
  overlayWindow: OverlayWindowController;
  trayController: TrayController | null;
  websocketServer: LocalWebSocketServer;
  dictionaryService: DictionaryService;
  textToSpeechService: TextToSpeechService;
  learningStore: LearningStore;
  savedWordsWindow: SavedWordsWindowController | null;
  session: AppSessionState;
};

export const getRuntimeConfig = (context: AppContext): AppConfig => context.runtimeStore.getState().config;

export const getRuntimeOverlayState = (context: AppContext): OverlayUiState =>
  context.runtimeStore.getState().overlay;

export const getRuntimeConnection = (context: AppContext): OverlayConnectionState =>
  context.runtimeStore.getState().connection;

export const getRuntimePlayer = (context: AppContext): PlayerStateMessage | null =>
  context.runtimeStore.getState().player;

export const getRuntimeSubtitle = (context: AppContext): SubtitleUpdateMessage | null =>
  context.runtimeStore.getState().subtitle;
