import type { PlayerStateMessage, SubtitleUpdateMessage } from "@youtube-subtitle-companion/shared";

import type { OverlayConnectionState, OverlayUiState } from "../common/types";

export const isPlayerPausedForOverlay = (
  playerState: PlayerStateMessage | null,
  connection: OverlayConnectionState | null
): boolean => (playerState ? !playerState.playing : connection?.sourcePlaying === false);

export const canSelectSubtitleWords = (
  uiState: OverlayUiState | null,
  playerState: PlayerStateMessage | null,
  connection: OverlayConnectionState | null,
  subtitle: SubtitleUpdateMessage | null
): boolean => uiState?.mode === "active" && isPlayerPausedForOverlay(playerState, connection) && subtitle !== null;
