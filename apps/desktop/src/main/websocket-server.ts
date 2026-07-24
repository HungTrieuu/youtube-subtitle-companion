import type { AddressInfo } from "node:net";

import {
  clampTime,
  type ExtensionHelloMessage,
  type ExtensionToElectronMessage,
  type PlayerCommandMessage,
  type PlayerStateMessage,
  type SubtitleTimelineCue,
  type SubtitleTimelineMessage,
  type SubtitleUpdateMessage,
  parseExtensionMessage,
  selectActiveSource
} from "@youtube-subtitle-companion/shared";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import type { OverlayConnectionState } from "../common/types";
import { logger } from "./logger";

type ExtensionClientRecord = {
  connectionId: string;
  socket: WebSocket;
  connectedAt: number;
  lastMessageAt: number;
  lastPlayerStateAt: number | null;
  lastSubtitleAt: number | null;
  hello: ExtensionHelloMessage | null;
  playerState: PlayerStateMessage | null;
  subtitle: SubtitleUpdateMessage | null;
  subtitleTimeline: SubtitleTimelineCue[] | null;
  subtitleTimelineVideoId: string | null;
  subtitleTimelineIndex: number;
};

type WebSocketServerEvents = {
  onSubtitle(subtitle: SubtitleUpdateMessage | null): void;
  onPlayerState(playerState: PlayerStateMessage | null): void;
  onConnection(connection: OverlayConnectionState): void;
};

const CLEAR_SUBTITLE_DELAY_MS = 1500;
const TIMELINE_TICK_MS = 250;

const summarizeCommandlessState = (record: ExtensionClientRecord) => ({
  connectionId: record.connectionId,
  clientId: record.hello?.clientId ?? null,
  version: record.hello?.version ?? null,
  videoId: record.playerState?.videoId ?? null,
  title: record.playerState?.title ?? null,
  playing: record.playerState?.playing ?? null,
  playbackRate: record.playerState?.playbackRate ?? null
});

const decodePayload = (raw: RawData): unknown => {
  const text =
    typeof raw === "string"
      ? raw
      : raw instanceof ArrayBuffer
        ? Buffer.from(raw).toString("utf8")
        : Array.isArray(raw)
          ? Buffer.concat(raw).toString("utf8")
          : raw.toString("utf8");

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export class LocalWebSocketServer {
  private server: WebSocketServer | null = null;
  private readonly clients = new Map<string, ExtensionClientRecord>();
  private activeConnectionId: string | null = null;
  private clearSubtitleTimer: NodeJS.Timeout | null = null;
  private timelineTimer: NodeJS.Timeout | null = null;

  public constructor(private readonly events: WebSocketServerEvents) {}

  public async start(): Promise<void> {
    if (this.server !== null) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server = new WebSocketServer({
        host: "127.0.0.1",
        port: 8765
      });

      this.server.on("connection", (socket) => {
        const now = Date.now();
        const connectionId = `${now}-${Math.random().toString(36).slice(2, 10)}`;
        const record: ExtensionClientRecord = {
          connectionId,
          socket,
          connectedAt: now,
          lastMessageAt: now,
          lastPlayerStateAt: null,
          lastSubtitleAt: null,
          hello: null,
          playerState: null,
          subtitle: null,
          subtitleTimeline: null,
          subtitleTimelineVideoId: null,
          subtitleTimelineIndex: 0
        };

        this.clients.set(connectionId, record);
        logger.debug("ws", "Extension connected", {
          connectionId
        });
        this.refreshActiveSource();

        socket.on("message", (raw) => {
          this.handleMessage(record, raw);
        });

        socket.on("close", () => {
          logger.debug("ws", "Extension disconnected", {
            connectionId
          });
          this.clients.delete(connectionId);
          this.refreshActiveSource();
        });

        socket.on("error", (error) => {
          logger.warn("ws", "Client socket error", error);
        });
      });

      this.server.on("listening", () => {
        const address = this.server?.address() as AddressInfo | null;
        logger.debug("ws", "WebSocket server listening", address);
        resolve();
      });

      this.server.on("error", (error) => {
        logger.error("ws", "WebSocket server error", error);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });

    this.timelineTimer = setInterval(() => {
      this.tickActiveTimeline();
    }, TIMELINE_TICK_MS);
  }

  public async stop(): Promise<void> {
    if (this.clearSubtitleTimer) {
      clearTimeout(this.clearSubtitleTimer);
      this.clearSubtitleTimer = null;
    }

    if (this.timelineTimer) {
      clearInterval(this.timelineTimer);
      this.timelineTimer = null;
    }

    if (this.server === null) {
      return;
    }

    for (const client of this.clients.values()) {
      client.socket.close(1001, "Server shutting down");
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }

        resolve();
      });
    });

    this.server = null;
    this.clients.clear();
    this.activeConnectionId = null;
  }

  public getConnectionState(): OverlayConnectionState {
    const active = this.getActiveClient();
    const status =
      active === null
        ? "waiting_for_extension"
        : active.playerState === null
          ? "waiting_for_player"
          : active.subtitle === null
            ? "waiting_for_subtitle"
            : "receiving_subtitles";

    return {
      connected: active !== null,
      clientCount: this.clients.size,
      activeConnectionId: this.activeConnectionId,
      clientId: active?.hello?.clientId ?? null,
      extensionVersion: active?.hello?.version ?? null,
      sourceTitle: active?.playerState?.title ?? null,
      sourceVideoId: active?.playerState?.videoId ?? null,
      sourcePlaying: active?.playerState?.playing ?? null,
      sourcePlaybackRate: active?.playerState?.playbackRate ?? null,
      lastHelloAt: active?.hello?.timestamp ?? null,
      lastMessageAt: active?.lastMessageAt ?? null,
      lastPlayerStateAt: active?.lastPlayerStateAt ?? null,
      lastSubtitleAt: active?.lastSubtitleAt ?? null,
      status
    };
  }

  public getActivePlayerState(): PlayerStateMessage | null {
    return this.getActiveClient()?.playerState ?? null;
  }

  public getActiveSubtitle(): SubtitleUpdateMessage | null {
    return this.getActiveClient()?.subtitle ?? null;
  }

  public sendCommand(command: PlayerCommandMessage): boolean {
    const active = this.getActiveClient();

    if (!active || active.socket.readyState !== WebSocket.OPEN) {
      logger.warn("ws", "Skipping player command because no active extension is ready", {
        command: command.command,
        activeConnectionId: this.activeConnectionId
      });
      return false;
    }

    active.socket.send(JSON.stringify(command));
    logger.debug("ws", "Sent player command to active extension", {
      command: command.command,
      target: summarizeCommandlessState(active)
    });
    return true;
  }

  public reconnectAll(): void {
    logger.debug("ws", "Forcing all extension clients to reconnect", {
      clientCount: this.clients.size
    });
    for (const client of this.clients.values()) {
      client.socket.close(1012, "Reconnect requested");
    }
  }

  private handleMessage(record: ExtensionClientRecord, raw: RawData): void {
    const parsed = parseExtensionMessage(decodePayload(raw));

    if (parsed === null) {
      logger.warn("ws", "Ignoring invalid message from extension");
      return;
    }

    record.lastMessageAt = Date.now();
    this.applyMessage(record, parsed);
  }

  private applyMessage(record: ExtensionClientRecord, message: ExtensionToElectronMessage): void {
    switch (message.type) {
      case "extension.hello":
        record.hello = message;
        logger.debug("ws", "Extension hello received", {
          connectionId: record.connectionId,
          clientId: message.clientId,
          version: message.version
        });
        this.refreshActiveSource();
        return;

      case "player.state":
        if (
          record.playerState === null ||
          record.playerState.videoId !== message.videoId ||
          record.playerState.playing !== message.playing ||
          record.playerState.playbackRate !== message.playbackRate
        ) {
          logger.debug("ws", "Player state updated", {
            connectionId: record.connectionId,
            videoId: message.videoId,
            title: message.title,
            playing: message.playing,
            playbackRate: message.playbackRate,
            currentTime: message.currentTime
          });
        }

        if (record.playerState && record.playerState.videoId !== message.videoId) {
          this.clearTimeline(record);
          record.subtitle = null;
        }

        record.playerState = message;
        record.lastPlayerStateAt = message.timestamp;
        this.refreshActiveSource();

        if (record.connectionId === this.activeConnectionId && record.subtitleTimeline) {
          this.pushTimelineSubtitle(record);
        }
        return;

      case "subtitle.timeline":
        this.applySubtitleTimeline(record, message);
        return;

      case "subtitle.update":
        if (record.subtitleTimeline !== null) {
          record.lastSubtitleAt = message.timestamp;
          return;
        }

        if (record.subtitle === null) {
          logger.debug("ws", "Subtitle feed became active", {
            connectionId: record.connectionId,
            videoId: message.videoId,
            preview: message.text.slice(0, 80)
          });
        }

        record.subtitle = message;
        record.lastSubtitleAt = message.timestamp;
        if (record.connectionId === this.activeConnectionId) {
          this.cancelSubtitleClear();
          this.events.onSubtitle(message);
          this.events.onConnection(this.getConnectionState());
        }
        return;

      case "subtitle.clear":
        if (record.subtitleTimeline !== null) {
          return;
        }

        if (record.subtitle !== null) {
          logger.debug("ws", "Subtitle feed cleared", {
            connectionId: record.connectionId,
            videoId: message.videoId
          });
        }

        record.subtitle = null;
        if (record.connectionId === this.activeConnectionId) {
          this.scheduleSubtitleClear();
          this.events.onConnection(this.getConnectionState());
        }
        return;
    }
  }

  private applySubtitleTimeline(
    record: ExtensionClientRecord,
    message: SubtitleTimelineMessage
  ): void {
    record.subtitleTimeline = message.cues;
    record.subtitleTimelineVideoId = message.videoId;
    record.subtitleTimelineIndex = 0;
    record.lastSubtitleAt = message.timestamp;
    logger.debug("ws", "Subtitle timeline loaded", {
      connectionId: record.connectionId,
      videoId: message.videoId,
      cues: message.cues.length
    });

    if (record.connectionId === this.activeConnectionId) {
      this.pushTimelineSubtitle(record);
      this.events.onConnection(this.getConnectionState());
    }
  }

  private clearTimeline(record: ExtensionClientRecord): void {
    record.subtitleTimeline = null;
    record.subtitleTimelineVideoId = null;
    record.subtitleTimelineIndex = 0;
  }

  private getActiveClient(): ExtensionClientRecord | null {
    if (this.activeConnectionId === null) {
      return null;
    }

    return this.clients.get(this.activeConnectionId) ?? null;
  }

  private refreshActiveSource(): void {
    const selected = selectActiveSource(
      [...this.clients.values()].map((client) => ({
        connectionId: client.connectionId,
        connectedAt: client.connectedAt,
        lastMessageAt: client.lastMessageAt,
        lastPlayerStateAt: client.lastPlayerStateAt,
        playerState: client.playerState
      }))
    );
    const previousConnectionId = this.activeConnectionId;
    this.activeConnectionId = selected?.connectionId ?? null;

    if (previousConnectionId !== this.activeConnectionId) {
      const active = this.getActiveClient();
      logger.debug("ws", "Active source changed", {
        status: this.getConnectionState().status,
        active: active ? summarizeCommandlessState(active) : null
      });
    }

    const active = this.getActiveClient();
    this.events.onPlayerState(active?.playerState ?? null);

    if (active?.subtitleTimeline) {
      this.cancelSubtitleClear();
      this.pushTimelineSubtitle(active);
    } else if (active?.subtitle) {
      this.cancelSubtitleClear();
      this.events.onSubtitle(active.subtitle);
    } else if (active === null) {
      this.scheduleSubtitleClear();
    } else {
      this.events.onSubtitle(null);
    }

    this.events.onConnection(this.getConnectionState());
  }

  private tickActiveTimeline(): void {
    const active = this.getActiveClient();

    if (!active?.subtitleTimeline || !active.playerState) {
      return;
    }

    this.pushTimelineSubtitle(active);
  }

  private pushTimelineSubtitle(record: ExtensionClientRecord): void {
    const previousSubtitle = record.subtitle;
    const nextSubtitle = this.getTimelineSubtitle(record);

    if (
      previousSubtitle?.text === nextSubtitle?.text &&
      previousSubtitle?.cueStartMs === nextSubtitle?.cueStartMs &&
      previousSubtitle?.cueEndMs === nextSubtitle?.cueEndMs
    ) {
      return;
    }

    record.subtitle = nextSubtitle;

    if (record.connectionId !== this.activeConnectionId) {
      return;
    }

    if (nextSubtitle) {
      record.lastSubtitleAt = nextSubtitle.timestamp;
      this.cancelSubtitleClear();
      if (previousSubtitle === null) {
        logger.debug("ws", "Subtitle feed became active", {
          connectionId: record.connectionId,
          videoId: nextSubtitle.videoId,
          preview: nextSubtitle.text.slice(0, 80)
        });
      }
      this.events.onSubtitle(nextSubtitle);
    } else {
      if (previousSubtitle !== null) {
        logger.debug("ws", "Subtitle feed cleared", {
          connectionId: record.connectionId,
          videoId: record.playerState?.videoId ?? record.subtitleTimelineVideoId
        });
      }
      this.scheduleSubtitleClear();
    }

    this.events.onConnection(this.getConnectionState());
  }

  private getTimelineSubtitle(record: ExtensionClientRecord): SubtitleUpdateMessage | null {
    if (
      !record.playerState ||
      !record.subtitleTimeline ||
      record.subtitleTimeline.length === 0 ||
      record.subtitleTimelineVideoId !== record.playerState.videoId
    ) {
      return null;
    }

    const currentTimeMs = this.derivePlayerCurrentTime(record.playerState) * 1000;
    let index = Math.min(
      record.subtitleTimelineIndex,
      Math.max(record.subtitleTimeline.length - 1, 0)
    );

    while (index > 0 && record.subtitleTimeline[index]!.startMs > currentTimeMs) {
      index -= 1;
    }

    while (
      index < record.subtitleTimeline.length &&
      record.subtitleTimeline[index]!.endMs <= currentTimeMs
    ) {
      index += 1;
    }

    record.subtitleTimelineIndex = index;
    const cue = record.subtitleTimeline[index];

    if (!cue || cue.startMs > currentTimeMs || currentTimeMs >= cue.endMs) {
      return null;
    }

    return {
      type: "subtitle.update",
      timestamp: Date.now(),
      videoId: record.playerState.videoId,
      text: cue.text,
      currentTime: currentTimeMs / 1000,
      cueStartMs: cue.startMs,
      cueEndMs: cue.endMs,
      ...(cue.segments ? { segments: cue.segments } : {})
    };
  }

  private derivePlayerCurrentTime(playerState: PlayerStateMessage): number {
    if (!playerState.playing) {
      return clampTime(playerState.currentTime, playerState.duration);
    }

    const elapsedSeconds = Math.max(0, (Date.now() - playerState.timestamp) / 1000);
    return clampTime(
      playerState.currentTime + elapsedSeconds * playerState.playbackRate,
      playerState.duration
    );
  }

  private cancelSubtitleClear(): void {
    if (this.clearSubtitleTimer) {
      clearTimeout(this.clearSubtitleTimer);
      this.clearSubtitleTimer = null;
    }
  }

  private scheduleSubtitleClear(): void {
    this.cancelSubtitleClear();
    this.clearSubtitleTimer = setTimeout(() => {
      this.events.onSubtitle(null);
      this.clearSubtitleTimer = null;
    }, CLEAR_SUBTITLE_DELAY_MS);
  }
}
