import { describe, expect, it } from "vitest";

import {
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
    const message = parseElectronMessage(createSeekRelativeCommand(-10));

    expect(message).not.toBeNull();
    expect(message?.command).toBe("seek_relative");
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
});
