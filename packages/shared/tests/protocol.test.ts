import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXTENSION_CAPABILITIES,
  createHelloMessage,
  createPlayerCommandResultMessage,
  createSeekRelativeCommand,
  parseElectronMessage,
  parseExtensionMessage
} from "../src/index";

describe("message schema validation", () => {
  it("accepts valid extension payloads", () => {
    const message = parseExtensionMessage({
      type: "player.state",
      timestamp: 1,
      videoId: "abc123",
      title: "Video title",
      currentTime: 12.5,
      duration: 90,
      playing: true,
      playbackRate: 1
    });

    expect(message).not.toBeNull();
    expect(message?.type).toBe("player.state");
  });

  it("accepts subtitle timelines with timed segments", () => {
    const message = parseExtensionMessage({
      type: "subtitle.timeline",
      timestamp: 1,
      videoId: "abc123",
      cues: [
        {
          startMs: 1000,
          endMs: 2200,
          text: "Hello world",
          segments: [
            {
              startMs: 1000,
              endMs: 1500,
              text: "Hello"
            },
            {
              startMs: 1500,
              endMs: 2200,
              text: " world"
            }
          ]
        }
      ]
    });

    expect(message).not.toBeNull();
    expect(message?.type).toBe("subtitle.timeline");
  });

  it("rejects malformed extension payloads", () => {
    const message = parseExtensionMessage({
      type: "subtitle.update",
      timestamp: 1,
      videoId: "abc123",
      text: "",
      currentTime: 2
    });

    expect(message).toBeNull();
  });

  it("accepts valid command payloads", () => {
    const message = parseElectronMessage(createSeekRelativeCommand(-10, "req-1"));

    expect(message).not.toBeNull();
    expect(message?.command).toBe("seek_relative");
    expect(message?.requestId).toBe("req-1");
  });

  it("rejects invalid command payloads", () => {
    const message = parseElectronMessage({
      type: "player.command",
      timestamp: 1,
      command: "seek_relative",
      seconds: "fast"
    });

    expect(message).toBeNull();
  });

  it("keeps hello backward compatible when capabilities are omitted", () => {
    const message = parseExtensionMessage({
      type: "extension.hello",
      timestamp: 1,
      clientId: "client-1",
      version: "0.1.0"
    });

    expect(message).toEqual({
      type: "extension.hello",
      timestamp: 1,
      clientId: "client-1",
      version: "0.1.0"
    });
  });

  it("accepts hello payloads with known capabilities", () => {
    const message = parseExtensionMessage(createHelloMessage("client-1"));

    expect(message?.type).toBe("extension.hello");
    expect(message?.capabilities).toEqual(DEFAULT_EXTENSION_CAPABILITIES);
  });

  it("rejects hello payloads with unknown capabilities", () => {
    const message = parseExtensionMessage({
      type: "extension.hello",
      timestamp: 1,
      clientId: "client-1",
      version: "0.1.0",
      capabilities: ["totally-unknown"]
    });

    expect(message).toBeNull();
  });

  it("accepts player command result payloads", () => {
    const message = parseExtensionMessage(
      createPlayerCommandResultMessage("req-1", false, "video not ready")
    );

    expect(message).toEqual({
      type: "player.command_result",
      timestamp: expect.any(Number),
      requestId: "req-1",
      success: false,
      error: "video not ready"
    });
  });
});
