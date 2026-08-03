import { describe, expect, it, vi } from "vitest";

import { TextToSpeechService } from "./tts-service";

const createTransport = (overrides: Partial<ConstructorParameters<typeof TextToSpeechService>[0]> = {}) => ({
  getConnectionState: () => ({
    connected: true
  }),
  getActiveHello: () => ({
    capabilities: ["player.command-ack", "speech.tts"] as const
  }),
  sendCommandWithResult: vi.fn().mockResolvedValue({
    success: true
  }),
  ...overrides
});

describe("TextToSpeechService", () => {
  it("rejects invalid text before sending a command", async () => {
    const transport = createTransport();
    const service = new TextToSpeechService(transport);

    await expect(
      service.synthesize({
        text: "   "
      })
    ).resolves.toEqual({
      success: false,
      code: "invalid_text",
      error: "The subtitle text is invalid."
    });
    expect(transport.sendCommandWithResult).not.toHaveBeenCalled();
  });

  it("fails when no extension is connected", async () => {
    const transport = createTransport({
      getConnectionState: () => ({
        connected: false
      })
    });
    const service = new TextToSpeechService(transport);

    await expect(
      service.synthesize({
        text: "Hello there"
      })
    ).resolves.toEqual({
      success: false,
      code: "unavailable",
      error: "No active extension is connected."
    });
  });

  it("fails when the connected extension does not support speech", async () => {
    const transport = createTransport({
      getActiveHello: () => ({
        capabilities: ["player.command-ack"] as const
      })
    });
    const service = new TextToSpeechService(transport);

    await expect(
      service.synthesize({
        text: "Hello there"
      })
    ).resolves.toEqual({
      success: false,
      code: "unsupported",
      error: "The connected extension does not support subtitle speech."
    });
  });

  it("dispatches the speech command when the extension supports it", async () => {
    const transport = createTransport();
    const service = new TextToSpeechService(transport);

    await expect(
      service.synthesize({
        text: "Hello there",
        language: "en-US"
      })
    ).resolves.toEqual({
      success: true
    });
    expect(transport.sendCommandWithResult).toHaveBeenCalledTimes(1);
    expect(transport.sendCommandWithResult).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "player.command",
        command: "speak_text",
        text: "Hello there",
        language: "en-US"
      })
    );
  });

  it("maps a rejected command dispatch to speak_failed", async () => {
    const transport = createTransport({
      sendCommandWithResult: vi.fn().mockResolvedValue({
        success: false,
        error: "Chrome reported no usable TTS voices."
      })
    });
    const service = new TextToSpeechService(transport);

    await expect(
      service.synthesize({
        text: "Hello there"
      })
    ).resolves.toEqual({
      success: false,
      code: "speak_failed",
      error: "Chrome reported no usable TTS voices."
    });
  });
});
