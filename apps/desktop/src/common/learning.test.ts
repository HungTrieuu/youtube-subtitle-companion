import { describe, expect, it } from "vitest";

import { normalizeLearningWord } from "./learning";

describe("normalizeLearningWord", () => {
  it("keeps apostrophes and hyphens inside words", () => {
    expect(normalizeLearningWord("don't")).toBe("don't");
    expect(normalizeLearningWord("well-known")).toBe("well-known");
  });

  it("strips punctuation at the start and end of a token", () => {
    expect(normalizeLearningWord("learning,")).toBe("learning");
    expect(normalizeLearningWord("\"Development\"")).toBe("development");
    expect(normalizeLearningWord("it's.")).toBe("it's");
  });

  it("rejects punctuation-only tokens", () => {
    expect(normalizeLearningWord("...")).toBeNull();
    expect(normalizeLearningWord("\"\"")).toBeNull();
  });
});
