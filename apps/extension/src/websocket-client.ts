import {
  getReconnectDelay,
  parseElectronMessage,
  type ElectronToExtensionMessage,
  type ExtensionToElectronMessage
} from "@youtube-subtitle-companion/shared";

import { extensionLogger } from "./logger";

type WebSocketClientHandlers = {
  onConnected(): void;
  onDisconnected(): void;
  onCommand(message: ElectronToExtensionMessage): void;
};

export class ExtensionWebSocketClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private attempt = 0;
  private stopped = false;

  public constructor(
    private readonly url: string,
    private readonly handlers: WebSocketClientHandlers
  ) {}

  public connect(): void {
    this.stopped = false;

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    extensionLogger.debug("Opening WebSocket connection to desktop app", {
      url: this.url
    });
    this.open();
  }

  public disconnect(): void {
    this.stopped = true;

    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.socket?.close();
    this.socket = null;
  }

  public send(message: ExtensionToElectronMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.socket.send(JSON.stringify(message));
    return true;
  }

  private open(): void {
    this.socket = new WebSocket(this.url);

    this.socket.addEventListener("open", () => {
      this.attempt = 0;
      extensionLogger.debug("WebSocket connected");
      this.handlers.onConnected();
    });

    this.socket.addEventListener("close", () => {
      extensionLogger.debug("WebSocket disconnected", {
        stopped: this.stopped
      });
      this.handlers.onDisconnected();
      this.socket = null;

      if (!this.stopped) {
        this.scheduleReconnect();
      }
    });

    this.socket.addEventListener("message", (event) => {
      let payload: unknown;

      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }

      const command = parseElectronMessage(payload);

      if (command) {
        extensionLogger.debug("Received extension command from desktop app", {
          command: command.command
        });
        this.handlers.onCommand(command);
        return;
      }

      extensionLogger.warn("Ignored invalid command payload from desktop app", payload);
    });

    this.socket.addEventListener("error", () => {
      extensionLogger.warn("WebSocket error received; closing socket to trigger reconnect");
      this.socket?.close();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }

    const delay = getReconnectDelay(this.attempt);
    this.attempt += 1;
    extensionLogger.debug("Scheduling reconnect", {
      attempt: this.attempt,
      delayMs: delay
    });
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }
}
