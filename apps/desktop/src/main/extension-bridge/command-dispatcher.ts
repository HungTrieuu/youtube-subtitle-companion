import {
  supportsCapability,
  type ExtensionHelloMessage,
  type PlayerCommandMessage,
  type PlayerCommandResultMessage
} from "@youtube-subtitle-companion/shared";

import { logger } from "../logger";

const playerCommandAckCapability = "player.command-ack";
const commandAckTimeoutMs = 2_500;

export type CommandDispatchResult = {
  success: boolean;
  error?: string;
};

type PendingCommand = {
  connectionId: string;
  commandName: PlayerCommandMessage["command"];
  timeoutId: NodeJS.Timeout;
  resolve(result: CommandDispatchResult): void;
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
    const result = await this.dispatchWithResult(connectionId, hello, command);
    return result.success;
  }

  public async dispatchWithResult(
    connectionId: string,
    hello: ExtensionHelloMessage | null,
    command: PlayerCommandMessage
  ): Promise<CommandDispatchResult> {
    const requiresAck = supportsCapability(hello, playerCommandAckCapability);
    const requestId = requiresAck ? command.requestId ?? createRequestId() : command.requestId;
    const payload = JSON.stringify(
      requestId ? { ...command, requestId } : command
    );

    if (!this.options.sendRaw(connectionId, payload)) {
      logger.warn("ws", "Skipping extension command because no active extension is ready", {
        command: command.command,
        activeConnectionId: connectionId
      });
      return {
        success: false,
        error: "No active extension is ready."
      };
    }

    logger.debug("ws", "Sent extension command to active extension", {
      command: command.command,
      connectionId,
      requestId: requestId ?? null,
      ackExpected: requiresAck
    });

    if (!requiresAck || !requestId) {
      return {
        success: true
      };
    }

    return new Promise<CommandDispatchResult>((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(requestId);
        logger.warn("ws", "Timed out waiting for extension command acknowledgement", {
          command: command.command,
          connectionId,
          requestId
        });
        resolve({
          success: false,
          error: "Timed out waiting for the extension command acknowledgement."
        });
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
      logger.debug("ws", "Extension command acknowledged successfully", {
        command: pending.commandName,
        connectionId,
        requestId: message.requestId
      });
    } else {
      logger.warn("ws", "Extension rejected command", {
        command: pending.commandName,
        connectionId,
        requestId: message.requestId,
        error: message.error ?? null
      });
    }

    pending.resolve({
      success: message.success,
      ...(message.error ? { error: message.error } : {})
    });
    return true;
  }

  public clearConnection(connectionId: string): void {
    for (const [requestId, pending] of this.pending.entries()) {
      if (pending.connectionId !== connectionId) {
        continue;
      }

      clearTimeout(pending.timeoutId);
      this.pending.delete(requestId);
      logger.warn("ws", "Cleared pending extension command after extension disconnect", {
        command: pending.commandName,
        connectionId,
        requestId
      });
      pending.resolve({
        success: false,
        error: "The extension disconnected while handling the command."
      });
    }
  }

  public clearAll(): void {
    for (const [requestId, pending] of this.pending.entries()) {
      clearTimeout(pending.timeoutId);
      this.pending.delete(requestId);
      pending.resolve({
        success: false,
        error: `The pending extension command ${requestId} was cleared.`
      });
    }
  }
}
