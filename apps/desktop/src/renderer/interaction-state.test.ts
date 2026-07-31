import { describe, expect, it } from "vitest";

import type { PlayerStateMessage, SubtitleUpdateMessage } from "@youtube-subtitle-companion/shared";

import type { OverlayConnectionState, OverlayUiState } from "../common/types";
import { canSelectSubtitleWords } from "./interaction-state";

const activeUiState: OverlayUiState = {
  mode: "active"
};

const pausedPlayerState: PlayerStateMessage = {
  type: "player.state",
  playing: false,
  currentTime: 12,
  duration: 120,
  playbackRate: 1,
  timestamp: 1_721_000_000_000,
  title: "Sample",
  videoId: "abc123"
};

const playingPlayerState: PlayerStateMessage = {
  ...pausedPlayerState,
  playing: true
};

const pausedConnectionState: OverlayConnectionState = {
  connected: true,
  clientCount: 1,
  activeConnectionId: "client-1",
  clientId: "client-1",
  extensionVersion: "1.0.0",
  sourceTitle: "Sample",
  sourceVideoId: "abc123",
  sourcePlaying: false,
  sourcePlaybackRate: 1,
  lastHelloAt: null,
  lastMessageAt: null,
  lastPlayerStateAt: null,
  lastSubtitleAt: null,
  status: "receiving_subtitles"
};

const subtitle: SubtitleUpdateMessage = {
  type: "subtitle.update",
  text: "Software development requires continuous learning.",
  currentTime: 12,
  videoId: "abc123",
  timestamp: 1_721_000_000_000
};

describe("canSelectSubtitleWords", () => {
  it("allows word selection only when the overlay is active and the video is paused", () => {
    expect(
      canSelectSubtitleWords(activeUiState, pausedPlayerState, pausedConnectionState, subtitle)
    ).toBe(true);
  });

  it("blocks word selection when the player is still playing", () => {
    expect(
      canSelectSubtitleWords(activeUiState, playingPlayerState, pausedConnectionState, subtitle)
    ).toBe(false);
  });

  it("blocks word selection when the overlay is inactive", () => {
    expect(
      canSelectSubtitleWords(
        {
          mode: "click_through"
        },
        pausedPlayerState,
        pausedConnectionState,
        subtitle
      )
    ).toBe(false);
  });

  it("falls back to the connection playing state when no player state is available", () => {
    expect(canSelectSubtitleWords(activeUiState, null, pausedConnectionState, subtitle)).toBe(true);
    expect(
      canSelectSubtitleWords(
        activeUiState,
        null,
        {
          ...pausedConnectionState,
          sourcePlaying: true
        },
        subtitle
      )
    ).toBe(false);
  });
});
