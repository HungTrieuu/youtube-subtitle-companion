import { describe, expect, it } from "vitest";

import {
  mergeCaptionSegments,
  normalizeSubtitleText
} from "../src/subtitle-reader";

describe("subtitle deduplication", () => {
  it("normalizes whitespace", () => {
    expect(normalizeSubtitleText("  Hello   world  ")).toBe("Hello world");
  });

  it("removes consecutive duplicate segments", () => {
    expect(mergeCaptionSegments(["Hello", "Hello", "world"])).toBe("Hello world");
  });

  it("returns null when every segment is empty", () => {
    expect(mergeCaptionSegments([" ", ""])).toBeNull();
  });
});
