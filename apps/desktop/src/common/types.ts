import type { PlayerStateMessage, SubtitleUpdateMessage } from "@youtube-subtitle-companion/shared";

export type TextAlignment = "left" | "center" | "right";
export type OverlaySourceStatus =
  | "waiting_for_extension"
  | "waiting_for_player"
  | "waiting_for_subtitle"
  | "receiving_subtitles";

export type AppConfig = {
  overlayVisible: boolean;
  clickThrough: boolean;
  fontSize: number;
  opacity: number;
  width: number;
  height: number;
  x?: number;
  y?: number;
  alignment: TextAlignment;
  autoStart: boolean;
  hotkeys: {
    togglePlay: string;
    seekBack: string;
    seekForward: string;
    toggleOverlay: string;
    toggleInteraction: string;
    moveOverlay: string;
    temporaryDim: string;
    increaseFont: string;
    decreaseFont: string;
  };
};

export type OverlayConnectionState = {
  connected: boolean;
  clientCount: number;
  activeConnectionId: string | null;
  clientId: string | null;
  extensionVersion: string | null;
  sourceTitle: string | null;
  sourceVideoId: string | null;
  sourcePlaying: boolean | null;
  sourcePlaybackRate: number | null;
  lastHelloAt: number | null;
  lastMessageAt: number | null;
  lastPlayerStateAt: number | null;
  lastSubtitleAt: number | null;
  status: OverlaySourceStatus;
};

export type OverlayInitialState = {
  subtitle: SubtitleUpdateMessage | null;
  playerState: PlayerStateMessage | null;
  config: AppConfig;
  connection: OverlayConnectionState;
};
