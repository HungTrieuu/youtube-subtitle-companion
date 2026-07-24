import { describe, expect, it } from "vitest";

import { selectActiveSource, type SourceCandidate } from "../src/index";

const baseCandidate = (overrides: Partial<SourceCandidate>): SourceCandidate => ({
  connectionId: "conn-1",
  connectedAt: 1,
  lastMessageAt: 1,
  lastPlayerStateAt: null,
  playerState: null,
  ...overrides
});

describe("active source selection", () => {
  it("prefers the newest playing source", () => {
    const selected = selectActiveSource([
      baseCandidate({
        connectionId: "idle",
        connectedAt: 10,
        lastMessageAt: 10,
        playerState: {
          type: "player.state",
          timestamp: 10,
          videoId: "a",
          title: "A",
          currentTime: 1,
          duration: 100,
          playing: false,
          playbackRate: 1
        }
      }),
      baseCandidate({
        connectionId: "playing",
        connectedAt: 5,
        lastMessageAt: 20,
        lastPlayerStateAt: 20,
        playerState: {
          type: "player.state",
          timestamp: 20,
          videoId: "b",
          title: "B",
          currentTime: 2,
          duration: 100,
          playing: true,
          playbackRate: 1
        }
      })
    ]);

    expect(selected?.connectionId).toBe("playing");
  });

  it("falls back to the latest connected source when nothing is playing", () => {
    const selected = selectActiveSource([
      baseCandidate({
        connectionId: "older",
        connectedAt: 100,
        lastMessageAt: 200
      }),
      baseCandidate({
        connectionId: "newer",
        connectedAt: 300,
        lastMessageAt: 150
      })
    ]);

    expect(selected?.connectionId).toBe("newer");
  });
});
