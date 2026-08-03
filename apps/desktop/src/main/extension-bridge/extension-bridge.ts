import {
  parseExtensionMessage,
  type ExtensionHelloMessage,
  type ExtensionToElectronMessage,
  type PlayerCommandMessage,
  type PlayerStateMessage,
  type SubtitleTimelineCue,
  type SubtitleTimelineMessage,
  type SubtitleUpdateMessage
} from "@youtube-subtitle-companion/shared";
import type { WebSocket } from "ws";

import type { OverlayConnectionState } from "../../common/types";
import { logger } from "../logger";
import { selectActiveConnectionId, summarizeCommandlessState } from "./active-source-manager";
import { CommandDispatcher, type CommandDispatchResult } from "./command-dispatcher";
import { getTimelineSubtitle } from "./subtitle-timeline-engine";
import {
  decodePayload,
  WebSocketTransport,
  type TransportConnection
} from "./websocket-transport";

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

const createClientRecord = (connection: TransportConnection): ExtensionClientRecord => ({
  connectionId: connection.connectionId,
  socket: connection.socket,
  connectedAt: connection.connectedAt,
  lastMessageAt: connection.connectedAt,
  lastPlayerStateAt: null,
  lastSubtitleAt: null,
  hello: null,
  playerState: null,
  subtitle: null,
  subtitleTimeline: null,
  subtitleTimelineVideoId: null,
  subtitleTimelineIndex: 0
});

export class LocalWebSocketServer {
  private readonly clients = new Map<string, ExtensionClientRecord>();
  private activeConnectionId: string | null = null;
  private clearSubtitleTimer: NodeJS.Timeout | null = null;
  private timelineTimer: NodeJS.Timeout | null = null;
  private readonly transport: WebSocketTransport;
  private readonly commandDispatcher: CommandDispatcher;

  public constructor(private readonly events: WebSocketServerEvents) {
    this.transport = new WebSocketTransport({
      onConnection: (connection) => {
        const record = createClientRecord(connection);
        this.clients.set(connection.connectionId, record);
        logger.debug("ws", "Extension connected", {
          connectionId: connection.connectionId
        });
        this.refreshActiveSource();
      },
      onMessage: (connection, raw) => {
        this.handleMessage(connection.connectionId, raw);
      },
      onClose: (connection) => {
        logger.debug("ws", "Extension disconnected", {
          connectionId: connection.connectionId
        });
        this.clients.delete(connection.connectionId);
        this.commandDispatcher.clearConnection(connection.connectionId);
        this.refreshActiveSource();
      },
      onSocketError: (_connection, error) => {
        logger.warn("ws", "Client socket error", error);
      },
      onListening: (address) => {
        logger.debug("ws", "WebSocket server listening", address);
      },
      onServerError: (error) => {
        logger.error("ws", "WebSocket server error", error);
      }
    });
    this.commandDispatcher = new CommandDispatcher({
      sendRaw: (connectionId, payload) => this.transport.send(connectionId, payload)
    });
  }

  public async start(): Promise<void> {
    await this.transport.start();
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

    this.commandDispatcher.clearAll();
    await this.transport.stop();
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

  public getActiveHello(): ExtensionHelloMessage | null {
    return this.getActiveClient()?.hello ?? null;
  }

  public async sendCommand(command: PlayerCommandMessage): Promise<boolean> {
    const active = this.getActiveClient();

    if (!active) {
      logger.warn("ws", "Skipping extension command because no active extension is ready", {
        command: command.command,
        activeConnectionId: this.activeConnectionId
      });
      return false;
    }

    return this.commandDispatcher.dispatch(active.connectionId, active.hello, command);
  }

  public async sendCommandWithResult(command: PlayerCommandMessage): Promise<CommandDispatchResult> {
    const active = this.getActiveClient();

    if (!active) {
      logger.warn("ws", "Skipping extension command because no active extension is ready", {
        command: command.command,
        activeConnectionId: this.activeConnectionId
      });
      return {
        success: false,
        error: "No active extension is ready."
      };
    }

    return this.commandDispatcher.dispatchWithResult(active.connectionId, active.hello, command);
  }

  public reconnectAll(): void {
    logger.debug("ws", "Forcing all extension clients to reconnect", {
      clientCount: this.clients.size
    });
    this.transport.closeAll(1012, "Reconnect requested");
  }

  private handleMessage(connectionId: string, raw: Parameters<typeof decodePayload>[0]): void {
    const record = this.clients.get(connectionId);

    if (!record) {
      return;
    }

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
          version: message.version,
          capabilities: message.capabilities ?? []
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
        if (
          record.subtitleTimeline !== null &&
          record.subtitleTimelineVideoId === message.videoId
        ) {
          record.lastSubtitleAt = message.timestamp;
          return;
        }

        if (
          record.subtitleTimeline !== null &&
          record.subtitleTimelineVideoId !== message.videoId
        ) {
          logger.debug("ws", "Discarded stale subtitle timeline after direct subtitle update", {
            connectionId: record.connectionId,
            timelineVideoId: record.subtitleTimelineVideoId,
            subtitleVideoId: message.videoId
          });
          this.clearTimeline(record);
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

      case "player.command_result":
        this.commandDispatcher.handleResult(record.connectionId, message);
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
    const previousConnectionId = this.activeConnectionId;
    this.activeConnectionId = selectActiveConnectionId(
      [...this.clients.values()].map((client) => ({
        connectionId: client.connectionId,
        connectedAt: client.connectedAt,
        lastMessageAt: client.lastMessageAt,
        lastPlayerStateAt: client.lastPlayerStateAt,
        playerState: client.playerState
      }))
    );

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
    const next = getTimelineSubtitle({
      playerState: record.playerState,
      subtitleTimeline: record.subtitleTimeline,
      subtitleTimelineVideoId: record.subtitleTimelineVideoId,
      subtitleTimelineIndex: record.subtitleTimelineIndex
    });
    const nextSubtitle = next.subtitle;
    record.subtitleTimelineIndex = next.nextIndex;

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
