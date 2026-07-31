import { describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "../config";
import {
  DesktopRuntimeStore,
  createInitialDesktopRuntimeState,
  deriveActiveSourceSummary
} from "./desktop-runtime-store";

const createStore = (): DesktopRuntimeStore =>
  new DesktopRuntimeStore(createInitialDesktopRuntimeState(DEFAULT_CONFIG));

describe("DesktopRuntimeStore", () => {
  it("returns cloned snapshots that cannot mutate internal state", () => {
    const store = createStore();
    const snapshot = store.getState();

    snapshot.config.fontSize = 99;

    expect(store.getState().config.fontSize).toBe(DEFAULT_CONFIG.fontSize);
  });

  it("notifies subscribers with overlay transitions and derived active source snapshots", () => {
    const store = createStore();
    const listener = vi.fn();

    store.subscribe(listener);
    store.update((state) => ({
      ...state,
      overlay: {
        mode: "active"
      }
    }));
    store.update((state) => ({
      ...state,
      player: {
        type: "player.state",
        timestamp: 1,
        videoId: "abc123",
        title: "Video title",
        currentTime: 12.5,
        duration: 90,
        playing: true,
        playbackRate: 1
      }
    }));
    store.update((state) => ({
      ...state,
      subtitle: {
        type: "subtitle.update",
        timestamp: 2,
        videoId: "abc123",
        text: "Hello world",
        currentTime: 12.5
      }
    }));
    store.update((state) => ({
      ...state,
      connection: {
        ...state.connection,
        connected: true,
        activeConnectionId: "conn-1",
        clientId: "client-1",
        sourceVideoId: "abc123",
        sourceTitle: "Video title",
        sourcePlaying: true,
        sourcePlaybackRate: 1,
        status: "receiving_subtitles"
      },
      activeSource: deriveActiveSourceSummary(
        {
          ...state.connection,
          connected: true,
          activeConnectionId: "conn-1",
          clientId: "client-1",
          sourceVideoId: "abc123",
          sourceTitle: "Video title",
          sourcePlaying: true,
          sourcePlaybackRate: 1,
          status: "receiving_subtitles"
        },
        state.player
      )
    }));

    expect(listener).toHaveBeenCalledTimes(4);
    expect(listener.mock.calls[0]?.[0].overlay.mode).toBe("active");
    expect(listener.mock.calls[1]?.[0].player?.videoId).toBe("abc123");
    expect(listener.mock.calls[2]?.[0].subtitle?.text).toBe("Hello world");
    expect(listener.mock.calls[3]?.[0].activeSource).toEqual({
      connectionId: "conn-1",
      clientId: "client-1",
      videoId: "abc123",
      title: "Video title",
      playing: true,
      playbackRate: 1
    });
  });

  it("supports unsubscribe", () => {
    const store = createStore();
    const listener = vi.fn();

    const unsubscribe = store.subscribe(listener);
    unsubscribe();

    store.update((state) => ({
      ...state,
      temporaryDimActive: true
    }));

    expect(listener).not.toHaveBeenCalled();
  });
});
