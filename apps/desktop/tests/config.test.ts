import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, sanitizeConfig } from "../src/main/config";

describe("config default and fallback", () => {
  it("returns defaults for invalid config", () => {
    expect(sanitizeConfig({ fontSize: "big" })).toEqual(DEFAULT_CONFIG);
  });

  it("merges partial config with defaults", () => {
    const config = sanitizeConfig({
      fontSize: 32,
      hotkeys: {
        togglePlay: "Control+Shift+Space"
      }
    });

    expect(config.fontSize).toBe(32);
    expect(config.hotkeys.togglePlay).toBe("Control+Shift+Space");
    expect(config.hotkeys.seekBack).toBe(DEFAULT_CONFIG.hotkeys.seekBack);
    expect(config.hotkeys.moveOverlay).toBe(DEFAULT_CONFIG.hotkeys.moveOverlay);
    expect(config.hotkeys.temporaryDim).toBe(DEFAULT_CONFIG.hotkeys.temporaryDim);
  });
});
