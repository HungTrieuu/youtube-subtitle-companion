import type {
  PlayerCommandMessage,
  PlayerStateMessage,
  SubtitleUpdateMessage
} from "@youtube-subtitle-companion/shared";

import type { AppConfig, OverlayConnectionState, OverlayInitialState } from "./types";

export const IPC_CHANNELS = {
  getInitialState: "overlay:get-initial-state",
  configUpdated: "overlay:config-updated",
  connectionUpdated: "overlay:connection-updated",
  playerStateUpdated: "overlay:player-state-updated",
  subtitleUpdated: "overlay:subtitle-updated",
  temporaryDimUpdated: "overlay:temporary-dim-updated",
  sendPlayerCommand: "overlay:send-player-command",
  toggleOverlay: "overlay:toggle-overlay",
  toggleInteraction: "overlay:toggle-interaction",
  adjustFont: "overlay:adjust-font",
  openContextMenu: "overlay:open-context-menu"
} as const;

export type OverlayContextMenuRequest = {
  x: number;
  y: number;
};

export type OverlayApi = {
  getInitialState(): Promise<OverlayInitialState>;
  onConfig(listener: (config: AppConfig) => void): () => void;
  onConnection(listener: (connection: OverlayConnectionState) => void): () => void;
  onPlayerState(listener: (playerState: PlayerStateMessage | null) => void): () => void;
  onSubtitle(listener: (subtitle: SubtitleUpdateMessage | null) => void): () => void;
  onTemporaryDim(listener: (active: boolean) => void): () => void;
  sendPlayerCommand(command: PlayerCommandMessage): void;
  toggleOverlay(): void;
  toggleInteraction(): void;
  adjustFont(delta: number): void;
  openContextMenu(payload: OverlayContextMenuRequest): Promise<void>;
};
