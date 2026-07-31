import type {
  PlayerStateMessage,
  SubtitleUpdateMessage
} from "@youtube-subtitle-companion/shared";

import type { AppConfig, OverlayConnectionState, OverlayUiState } from "../../common/types";

export type ActiveSourceSummary = {
  connectionId: string;
  clientId: string | null;
  videoId: string | null;
  title: string | null;
  playing: boolean | null;
  playbackRate: number | null;
};

export type DesktopRuntimeState = {
  config: AppConfig;
  overlay: OverlayUiState;
  connection: OverlayConnectionState;
  player: PlayerStateMessage | null;
  subtitle: SubtitleUpdateMessage | null;
  activeSource: ActiveSourceSummary | null;
  temporaryDimActive: boolean;
};

type DesktopRuntimeListener = (
  state: Readonly<DesktopRuntimeState>,
  previousState: Readonly<DesktopRuntimeState>
) => void;

const cloneState = (state: DesktopRuntimeState): DesktopRuntimeState => structuredClone(state);
const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  for (const nestedValue of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nestedValue);
  }

  return Object.freeze(value);
};

export const createWaitingConnectionState = (): OverlayConnectionState => ({
  connected: false,
  clientCount: 0,
  activeConnectionId: null,
  clientId: null,
  extensionVersion: null,
  sourceTitle: null,
  sourceVideoId: null,
  sourcePlaying: null,
  sourcePlaybackRate: null,
  lastHelloAt: null,
  lastMessageAt: null,
  lastPlayerStateAt: null,
  lastSubtitleAt: null,
  status: "waiting_for_extension"
});

export const deriveActiveSourceSummary = (
  connection: OverlayConnectionState,
  player: PlayerStateMessage | null
): ActiveSourceSummary | null => {
  if (!connection.connected || connection.activeConnectionId === null) {
    return null;
  }

  return {
    connectionId: connection.activeConnectionId,
    clientId: connection.clientId,
    videoId: player?.videoId ?? connection.sourceVideoId,
    title: player?.title ?? connection.sourceTitle,
    playing: player?.playing ?? connection.sourcePlaying,
    playbackRate: player?.playbackRate ?? connection.sourcePlaybackRate
  };
};

export const createInitialDesktopRuntimeState = (config: AppConfig): DesktopRuntimeState => ({
  config: structuredClone(config),
  overlay: {
    mode: "click_through"
  },
  connection: createWaitingConnectionState(),
  player: null,
  subtitle: null,
  activeSource: null,
  temporaryDimActive: false
});

export class DesktopRuntimeStore {
  private state: DesktopRuntimeState;
  private readonly listeners = new Set<DesktopRuntimeListener>();

  public constructor(initialState: DesktopRuntimeState) {
    this.state = deepFreeze(cloneState(initialState));
  }

  public getState(): Readonly<DesktopRuntimeState> {
    return cloneState(this.state);
  }

  public update(
    updater: (state: Readonly<DesktopRuntimeState>) => DesktopRuntimeState
  ): Readonly<DesktopRuntimeState> {
    const previousState = this.state;
    const nextState = updater(previousState);

    if (nextState === previousState) {
      return this.getState();
    }

    this.state = deepFreeze(nextState);

    for (const listener of this.listeners) {
      listener(this.state, previousState);
    }

    return this.getState();
  }

  public subscribe(listener: DesktopRuntimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
