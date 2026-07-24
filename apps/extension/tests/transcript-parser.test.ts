import { describe, expect, it } from "vitest";

import {
  parseTranscriptEvents,
  parseTranscriptText,
  parseVttTranscript,
  parseXmlTranscript
} from "../src/subtitle-reader";

describe("parseTranscriptEvents", () => {
  it("extracts normalized cues from YouTube json3 transcripts", () => {
    expect(
      parseTranscriptEvents({
        events: [
          {
            tStartMs: 1000,
            dDurationMs: 1500,
            segs: [{ utf8: " Hello " }, { utf8: "world" }]
          },
          {
            tStartMs: 2600,
            dDurationMs: 800,
            segs: [{ utf8: "Again" }]
          }
        ]
      })
    ).toEqual([
      {
        startMs: 1000,
        endMs: 2600,
        text: "Hello world"
      },
      {
        startMs: 2600,
        endMs: 3400,
        text: "Again"
      }
    ]);
  });

  it("ignores transcript events without usable text", () => {
    expect(
      parseTranscriptEvents({
        events: [
          {
            tStartMs: 0,
            dDurationMs: 500,
            segs: [{ utf8: "   " }]
          }
        ]
      })
    ).toEqual([]);
  });

  it("parses srv3-style xml transcripts", () => {
    expect(
      parseXmlTranscript(`
        <timedtext>
          <body>
            <p t="1000" d="1400"><s> Hello </s><s>world</s></p>
            <p t="2600" d="900">Again &amp; again</p>
          </body>
        </timedtext>
      `)
    ).toEqual([
      {
        startMs: 1000,
        endMs: 2600,
        text: "Hello world"
      },
      {
        startMs: 2600,
        endMs: 3500,
        text: "Again & again"
      }
    ]);
  });

  it("parses webvtt transcripts", () => {
    expect(
      parseVttTranscript(`WEBVTT

00:01.000 --> 00:02.500
Hello world

00:02.600 --> 00:03.400
Again`)
    ).toEqual([
      {
        startMs: 1000,
        endMs: 2500,
        text: "Hello world"
      },
      {
        startMs: 2600,
        endMs: 3400,
        text: "Again"
      }
    ]);
  });

  it("sniffs transcript text formats automatically", () => {
    expect(
      parseTranscriptText(`)]}'
{"events":[{"tStartMs":1000,"dDurationMs":800,"segs":[{"utf8":"Hello"}]}]}`)
    ).toEqual([
      {
        startMs: 1000,
        endMs: 1800,
        text: "Hello"
      }
    ]);
  });
});
