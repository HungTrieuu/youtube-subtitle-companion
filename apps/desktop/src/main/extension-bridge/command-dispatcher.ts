import {
  supportsCapability,
  type ExtensionHelloMessage,
  type PlayerCommandMessage,
  type PlayerCommandResultMessage
} from "@youtube-subtitle-companion/shared";

import { logger } from "../logger";

const playerCommandAckCapability = "player.command-ack";
const commandAckTimeoutMs = 2_500;

type PendingCommand = {
  connectionId: string;
  commandName: PlayerCommandMessage["command"];
  timeoutId: NodeJS.Timeout;
  resolve(result: boolean): void;
};

type CommandDispatcherOptions = {
  sendRaw(connectionId: string, payload: string): boolean;
};

const createRequestId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export class CommandDispatcher {
  private readonly pending = new Map<string, PendingCommand>();

  public constructor(private readonly options: CommandDispatcherOptions) {}

  public async dispatch(
    connectionId: string,
    hello: ExtensionHelloMessage | null,
    command: PlayerCommandMessage
  ): Promise<boolean> {
    const requiresAck = supportsCapability(hello, playerCommandAckCapability);
    const requestId = requiresAck ? command.requestId ?? createRequestId() : command.requestId;
    const payload = JSON.stringify(
      requestId ? { ...command, requestId } : command
    );

    if (!this.options.sendRaw(connectionId, payload)) {
      logger.warn("ws", "Skipping player command because no active extension is ready", {
        command: command.command,
        activeConnectionId: connectionId
      });
      return false;
    }

    logger.debug("ws", "Sent player command to active extension", {
      command: command.command,
      connectionId,
      requestId: requestId ?? null,
      ackExpected: requiresAck
    });

    if (!requiresAck || !requestId) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(requestId);
        logger.warn("ws", "Timed out waiting for player command acknowledgement", {
          command: command.command,
          connectionId,
          requestId
        });
        resolve(false);
      }, commandAckTimeoutMs);

      this.pending.set(requestId, {
        connectionId,
        commandName: command.command,
        timeoutId,
        resolve
      });
    });
  }

  public handleResult(
    connectionId: string,
    message: PlayerCommandResultMessage
  ): boolean {
    const pending = this.pending.get(message.requestId);

    if (!pending || pending.connectionId !== connectionId) {
      return false;
    }

    clearTimeout(pending.timeoutId);
    this.pending.delete(message.requestId);

    if (message.success) {
      logger.debug("ws", "Player command acknowledged successfully", {
        command: pending.commandName,
        connectionId,
        requestId: message.requestId
      });
    } else {
      logger.warn("ws", "Extension rejected player command", {
        command: pending.commandName,
        connectionId,
        requestId: message.requestId,
        error: message.error ?? null
      });
    }

    pending.resolve(message.success);
    return true;
  }

  public clearConnection(connectionId: string): void {
    for (const [requestId, pending] of this.pending.entries()) {
      if (pending.connectionId !== connectionId) {
        continue;
      }

      clearTimeout(pending.timeoutId);
      this.pending.delete(requestId);
      logger.warn("ws", "Cleared pending player command after extension disconnect", {
        command: pending.commandName,
        connectionId,
        requestId
      });
      pending.resolve(false);
    }
  }

  public clearAll(): void {
    for (const [requestId, pending] of this.pending.entries()) {
      clearTimeout(pending.timeoutId);
      this.pending.delete(requestId);
      pending.resolve(false);
    }
  }
}
