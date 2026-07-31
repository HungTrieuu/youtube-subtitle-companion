import type {
  PlayerCommandMessage,
  PlayerStateMessage,
  SubtitleUpdateMessage
} from "@youtube-subtitle-companion/shared";

import type {
  DeleteLearningItemResponse,
  DictionaryLookupResponse,
  LearningItemsResponse,
  DeleteLearningItemRequest,
  SaveLearningItemRequest,
  SaveLearningItemResponse
} from "./learning";
import type { AppConfig, OverlayConnectionState, OverlayInitialState } from "./types";

export const IPC_CHANNELS = {
  getInitialState: "overlay:get-initial-state",
  configUpdated: "overlay:config-updated",
  connectionUpdated: "overlay:connection-updated",
  uiStateUpdated: "overlay:ui-state-updated",
  playerStateUpdated: "overlay:player-state-updated",
  subtitleUpdated: "overlay:subtitle-updated",
  temporaryDimUpdated: "overlay:temporary-dim-updated",
  sendPlayerCommand: "overlay:send-player-command",
  toggleOverlay: "overlay:toggle-overlay",
  toggleOverlayActive: "overlay:toggle-overlay-active",
  adjustFont: "overlay:adjust-font",
  openContextMenu: "overlay:open-context-menu",
  setPopupMetrics: "overlay:set-popup-metrics",
  lookupDictionary: "overlay:lookup-dictionary",
  saveLearningItem: "overlay:save-learning-item",
  getLearningItems: "overlay:get-learning-items",
  deleteLearningItem: "overlay:delete-learning-item",
  learningItemsUpdated: "overlay:learning-items-updated"
} as const;

export type OverlayContextMenuRequest = {
  x: number;
  y: number;
};

export type OverlayPopupMetrics = {
  visible: boolean;
  reservedTop: number;
  reservedBottom: number;
};

export type OverlayApi = {
  getInitialState(): Promise<OverlayInitialState>;
  onConfig(listener: (config: AppConfig) => void): () => void;
  onConnection(listener: (connection: OverlayConnectionState) => void): () => void;
  onUiState(listener: (uiState: OverlayInitialState["uiState"]) => void): () => void;
  onPlayerState(listener: (playerState: PlayerStateMessage | null) => void): () => void;
  onSubtitle(listener: (subtitle: SubtitleUpdateMessage | null) => void): () => void;
  onTemporaryDim(listener: (active: boolean) => void): () => void;
  onLearningItemsUpdated(listener: () => void): () => void;
  sendPlayerCommand(command: PlayerCommandMessage): void;
  toggleOverlay(): void;
  toggleOverlayActive(): void;
  adjustFont(delta: number): void;
  openContextMenu(payload: OverlayContextMenuRequest): Promise<void>;
  setPopupMetrics(payload: OverlayPopupMetrics): void;
  lookupDictionary(word: string): Promise<DictionaryLookupResponse>;
  saveLearningItem(payload: SaveLearningItemRequest): Promise<SaveLearningItemResponse>;
  getLearningItems(): Promise<LearningItemsResponse>;
  deleteLearningItem(payload: DeleteLearningItemRequest): Promise<DeleteLearningItemResponse>;
};
