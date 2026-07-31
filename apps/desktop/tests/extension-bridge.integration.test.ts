import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import {
  createHelloMessage,
  createPlayerCommandResultMessage,
  createToggleCommand
} from "@youtube-subtitle-companion/shared";

import { LocalWebSocketServer } from "../src/main/websocket-server";

const waitFor = async (predicate: () => boolean, timeoutMs = 2_000): Promise<void> => {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
  }
};

const waitForOpen = (socket: WebSocket): Promise<void> =>
  new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });

describe("LocalWebSocketServer integration", () => {
  const sockets = new Set<WebSocket>();
  let server: LocalWebSocketServer | null = null;

  afterEach(async () => {
    for (const socket of sockets) {
      socket.close();
    }
    sockets.clear();

    if (server) {
      await server.stop();
      server = null;
    }
  });

  it("propagates hello, player state, and timeline subtitles from a fake extension", async () => {
    server = new LocalWebSocketServer({
      onSubtitle: () => {},
      onPlayerState: () => {},
      onConnection: () => {}
    });
    await server.start();

    const client = new WebSocket("ws://127.0.0.1:8765");
    sockets.add(client);
    await waitForOpen(client);

    client.send(JSON.stringify(createHelloMessage("client-1")));
    client.send(
      JSON.stringify({
        type: "player.state",
        timestamp: Date.now(),
        videoId: "abc123",
        title: "Video title",
        currentTime: 1.2,
        duration: 90,
        playing: true,
        playbackRate: 1
      })
    );
    client.send(
      JSON.stringify({
        type: "subtitle.timeline",
        timestamp: Date.now(),
        videoId: "abc123",
        cues: [
          {
            startMs: 1_000,
            endMs: 2_500,
            text: "Hello world"
          }
        ]
      })
    );

    await waitFor(() => server?.getConnectionState().status === "receiving_subtitles");

    expect(server!.getConnectionState()).toMatchObject({
      connected: true,
      clientId: "client-1",
      sourceVideoId: "abc123",
      status: "receiving_subtitles"
    });
    expect(server!.getActivePlayerState()).toMatchObject({
      videoId: "abc123",
      title: "Video title"
    });
    expect(server!.getActiveSubtitle()).toMatchObject({
      text: "Hello world"
    });
  });

  it("waits for player command acknowledgements when the extension advertises support", async () => {
    server = new LocalWebSocketServer({
      onSubtitle: () => {},
      onPlayerState: () => {},
      onConnection: () => {}
    });
    await server.start();

    const client = new WebSocket("ws://127.0.0.1:8765");
    sockets.add(client);
    await waitForOpen(client);

    client.on("message", (raw) => {
      const payload = JSON.parse(String(raw));

      if (payload.type !== "player.command" || typeof payload.requestId !== "string") {
        return;
      }

      client.send(JSON.stringify(createPlayerCommandResultMessage(payload.requestId, true)));
    });

    client.send(JSON.stringify(createHelloMessage("client-ack")));
    client.send(
      JSON.stringify({
        type: "player.state",
        timestamp: Date.now(),
        videoId: "abc123",
        title: "Video title",
        currentTime: 1,
        duration: 90,
        playing: true,
        playbackRate: 1
      })
    );

    await waitFor(() => server?.getConnectionState().connected === true);
    await expect(server!.sendCommand(createToggleCommand())).resolves.toBe(true);
  });

  it("falls back to fire-and-forget commands for older clients without capabilities", async () => {
    server = new LocalWebSocketServer({
      onSubtitle: () => {},
      onPlayerState: () => {},
      onConnection: () => {}
    });
    await server.start();

    const client = new WebSocket("ws://127.0.0.1:8765");
    sockets.add(client);
    await waitForOpen(client);

    client.send(
      JSON.stringify({
        type: "extension.hello",
        timestamp: Date.now(),
        clientId: "client-legacy",
        version: "0.1.0"
      })
    );
    client.send(
      JSON.stringify({
        type: "player.state",
        timestamp: Date.now(),
        videoId: "abc123",
        title: "Video title",
        currentTime: 1,
        duration: 90,
        playing: true,
        playbackRate: 1
      })
    );

    await waitFor(() => server?.getConnectionState().connected === true);
    await expect(server!.sendCommand(createToggleCommand())).resolves.toBe(true);
  });
});
