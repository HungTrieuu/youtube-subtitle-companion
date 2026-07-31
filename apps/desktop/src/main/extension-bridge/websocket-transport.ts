import type { AddressInfo } from "node:net";

import { WebSocket, WebSocketServer, type RawData } from "ws";

export type TransportConnection = {
  connectionId: string;
  socket: WebSocket;
  connectedAt: number;
};

type WebSocketTransportHandlers = {
  onConnection(connection: TransportConnection): void;
  onMessage(connection: TransportConnection, raw: RawData): void;
  onClose(connection: TransportConnection): void;
  onSocketError(connection: TransportConnection, error: Error): void;
  onListening(address: AddressInfo | null): void;
  onServerError(error: Error): void;
};

export const decodePayload = (raw: RawData): unknown => {
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

export class WebSocketTransport {
  private server: WebSocketServer | null = null;
  private readonly connections = new Map<string, TransportConnection>();

  public constructor(private readonly handlers: WebSocketTransportHandlers) {}

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
        const connection: TransportConnection = {
          connectionId,
          socket,
          connectedAt: now
        };

        this.connections.set(connectionId, connection);
        this.handlers.onConnection(connection);

        socket.on("message", (raw) => {
          this.handlers.onMessage(connection, raw);
        });

        socket.on("close", () => {
          this.connections.delete(connectionId);
          this.handlers.onClose(connection);
        });

        socket.on("error", (error) => {
          this.handlers.onSocketError(connection, error instanceof Error ? error : new Error(String(error)));
        });
      });

      this.server.on("listening", () => {
        this.handlers.onListening(this.server?.address() as AddressInfo | null);
        resolve();
      });

      this.server.on("error", (error) => {
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.handlers.onServerError(normalized);
        reject(normalized);
      });
    });
  }

  public async stop(): Promise<void> {
    if (this.server === null) {
      return;
    }

    for (const connection of this.connections.values()) {
      connection.socket.close(1001, "Server shutting down");
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
    this.connections.clear();
  }

  public send(connectionId: string, payload: string): boolean {
    const connection = this.connections.get(connectionId);

    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    connection.socket.send(payload);
    return true;
  }

  public closeAll(code: number, reason: string): void {
    for (const connection of this.connections.values()) {
      connection.socket.close(code, reason);
    }
  }
}
