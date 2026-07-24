import { describe, expect, it } from "vitest";

import { getReconnectDelay } from "../src/index";

describe("reconnect delay calculation", () => {
  it("uses the documented backoff steps", () => {
    expect(getReconnectDelay(0)).toBe(1000);
    expect(getReconnectDelay(1)).toBe(2000);
    expect(getReconnectDelay(2)).toBe(5000);
    expect(getReconnectDelay(3)).toBe(10000);
  });

  it("caps the delay at ten seconds", () => {
    expect(getReconnectDelay(10)).toBe(10000);
  });
});
