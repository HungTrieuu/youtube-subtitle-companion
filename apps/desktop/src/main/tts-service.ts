import {
  createSpeakTextCommand,
  supportsCapability,
  type ExtensionHelloMessage,
  type PlayerCommandMessage
} from "@youtube-subtitle-companion/shared";

import type { SpeakSubtitleRequest, SpeakSubtitleResponse } from "../common/tts";
import { speakSubtitleRequestSchema } from "../common/tts";
import { logger } from "./logger";

type SpeechCommandTransport = {
  getConnectionState(): {
    connected: boolean;
  };
  getActiveHello(): Pick<ExtensionHelloMessage, "capabilities"> | null;
  sendCommandWithResult(command: PlayerCommandMessage): Promise<{
    success: boolean;
    error?: string;
  }>;
};

const speechCapability = "speech.tts";

export class TextToSpeechService {
  public constructor(private readonly transport: SpeechCommandTransport) {}

  public async synthesize(payload: SpeakSubtitleRequest): Promise<SpeakSubtitleResponse> {
    const parsedRequest = speakSubtitleRequestSchema.safeParse(payload);

    if (!parsedRequest.success) {
      return {
        success: false,
        code: "invalid_text",
        error: "The subtitle text is invalid."
      };
    }

    const connectionState = this.transport.getConnectionState();

    if (!connectionState.connected) {
      return {
        success: false,
        code: "unavailable",
        error: "No active extension is connected."
      };
    }

    const hello = this.transport.getActiveHello();

    if (!supportsCapability(hello, speechCapability)) {
      return {
        success: false,
        code: "unsupported",
        error: "The connected extension does not support subtitle speech."
      };
    }

    try {
      const result = await this.transport.sendCommandWithResult(
        createSpeakTextCommand(parsedRequest.data.text, parsedRequest.data.language)
      );

      if (result.success) {
        return {
          success: true
        };
      }

      return {
        success: false,
        code: "speak_failed",
        error: result.error ?? "The extension could not start speech playback."
      };
    } catch (error) {
      logger.error("tts", "Unexpected subtitle speech failure", error);
      return {
        success: false,
        code: "speak_failed",
        error: "Speech playback failed."
      };
    }
  }
}
