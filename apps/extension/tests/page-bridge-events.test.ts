import { describe, expect, it } from "vitest";

import {
  PAGE_BRIDGE_CAPTION_TRACKS_EVENT,
  PAGE_BRIDGE_TIMEDTEXT_OBSERVED_EVENT,
  PAGE_BRIDGE_TRANSCRIPT_REQUEST_EVENT,
  PAGE_BRIDGE_TRANSCRIPT_RESPONSE_EVENT
} from "../src/page-bridge-events";

describe("page bridge events", () => {
  it("uses a stable caption track event name", () => {
    expect(PAGE_BRIDGE_CAPTION_TRACKS_EVENT).toBe("yt-sub-companion:caption-tracks");
  });

  it("uses stable transcript request and response event names", () => {
    expect(PAGE_BRIDGE_TIMEDTEXT_OBSERVED_EVENT).toBe("yt-sub-companion:timedtext-observed");
    expect(PAGE_BRIDGE_TRANSCRIPT_REQUEST_EVENT).toBe("yt-sub-companion:transcript-request");
    expect(PAGE_BRIDGE_TRANSCRIPT_RESPONSE_EVENT).toBe("yt-sub-companion:transcript-response");
  });
});
