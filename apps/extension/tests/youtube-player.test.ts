import { describe, expect, it } from "vitest";

import { resolvePlayerTitle } from "../src/youtube-player";

describe("resolvePlayerTitle", () => {
  it("prefers the visible heading title", () => {
    expect(
      resolvePlayerTitle({
        headingTitle: "Lex Fridman Podcast",
        documentTitle: "Fallback - YouTube",
        previousTitle: "Previous"
      })
    ).toBe("Lex Fridman Podcast");
  });

  it("falls back to the sanitized document title", () => {
    expect(
      resolvePlayerTitle({
        headingTitle: "   ",
        documentTitle: "Jensen Huang Interview - YouTube",
        previousTitle: "Previous"
      })
    ).toBe("Jensen Huang Interview");
  });

  it("keeps the previous title when the page stops exposing title text", () => {
    expect(
      resolvePlayerTitle({
        headingTitle: null,
        documentTitle: "",
        previousTitle: "Stable title"
      })
    ).toBe("Stable title");
  });
});
