import { describe, expect, it } from "vitest";

import { sanitizeConfig } from "./config";

describe("desktop config hotkey defaults", () => {
  it("uses Ctrl+Alt+A as the default active overlay hotkey", () => {
    expect(sanitizeConfig(undefined).hotkeys.toggleInteraction).toBe("Control+Alt+A");
  });

  it("migrates the previous default active overlay hotkey to Ctrl+Alt+A", () => {
    expect(
      sanitizeConfig({
        hotkeys: {
          toggleInteraction: "Control+Alt+I"
        }
      }).hotkeys.toggleInteraction
    ).toBe("Control+Alt+A");
  });

  it("preserves an existing custom hotkey", () => {
    expect(
      sanitizeConfig({
        hotkeys: {
          toggleInteraction: "Control+Shift+A"
        }
      }).hotkeys.toggleInteraction
    ).toBe("Control+Shift+A");
  });

  it("fills a missing hotkey with the new default", () => {
    expect(
      sanitizeConfig({
        hotkeys: {
          togglePlay: "Control+Alt+Space"
        }
      }).hotkeys.toggleInteraction
    ).toBe("Control+Alt+A");
  });
});
