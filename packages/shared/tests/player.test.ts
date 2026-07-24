import { describe, expect, it } from "vitest";

import { clampRelativeSeek, clampTime } from "../src/index";

describe("seek clamp logic", () => {
  it("clamps negative positions to zero", () => {
    expect(clampRelativeSeek(3, -10, 200)).toBe(0);
  });

  it("clamps forward seeks to duration", () => {
    expect(clampRelativeSeek(198, 10, 200)).toBe(200);
  });

  it("keeps finite values when duration is unknown", () => {
    expect(clampTime(12, Number.POSITIVE_INFINITY)).toBe(12);
  });
});
