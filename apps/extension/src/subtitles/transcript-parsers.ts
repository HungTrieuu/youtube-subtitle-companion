import type {
  SubtitleTimelineCue,
  SubtitleTimelineSegment
} from "@youtube-subtitle-companion/shared";

const XML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " "
};

type TranscriptCue = SubtitleTimelineCue;
type TranscriptSegment = SubtitleTimelineSegment;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const getArray = (value: unknown, key: string): unknown[] => {
  const record = asRecord(value);
  const candidate = record?.[key];
  return Array.isArray(candidate) ? candidate : [];
};

const getString = (value: unknown, key: string): string | null => {
  const record = asRecord(value);
  const candidate = record?.[key];
  return typeof candidate === "string" ? candidate : null;
};

const getNumber = (value: unknown, key: string): number | null => {
  const record = asRecord(value);
  const candidate = record?.[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
};

const parseSecondsToMs = (value: string | null): number | null => {
  if (!value) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric * 1000)) : null;
};

const parseIntegerMs = (value: string | null): number | null => {
  if (!value) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : null;
};

const decodeXmlEntities = (value: string): string =>
  value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, token: string) => {
    const lowered = token.toLowerCase();

    if (lowered in XML_ENTITY_MAP) {
      return XML_ENTITY_MAP[lowered] ?? entity;
    }

    if (lowered.startsWith("#x")) {
      const codePoint = Number.parseInt(lowered.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }

    if (lowered.startsWith("#")) {
      const codePoint = Number.parseInt(lowered.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }

    return entity;
  });

const stripMarkup = (value: string): string =>
  value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ");

export const buildTranscriptUrls = (baseUrl: string): string[] => {
  const url = new URL(baseUrl, location.origin);
  const candidates = [url.toString()];

  for (const fmt of ["json3", "srv3", "vtt"]) {
    const variant = new URL(url.toString());
    variant.searchParams.set("fmt", fmt);
    candidates.push(variant.toString());
  }

  return [...new Set(candidates)];
};

export const normalizeTranscriptPayload = (value: string): string =>
  value
    .replace(/^\uFEFF/, "")
    .replace(/^\)\]\}'\s*/, "")
    .trim();

const normalizeTranscriptFragment = (value: string): string =>
  value
    .replace(/\s+/g, " ")
    .trim();

const shouldAttachFragmentToPrevious = (value: string): boolean =>
  /^[,.;:!?%)\]}%]/.test(value);

const shouldPreviousFragmentAbsorbSpace = (value: string): boolean =>
  /[(\[{/"'`-]$/.test(value);

const buildDisplayFragments = (fragments: string[]): string[] => {
  const normalizedFragments = fragments
    .map(normalizeTranscriptFragment)
    .filter((fragment) => fragment.length > 0);
  const displayFragments: string[] = [];

  for (const fragment of normalizedFragments) {
    const previousFragment = displayFragments[displayFragments.length - 1]?.trim() ?? "";
    const needsLeadingSpace =
      displayFragments.length > 0 &&
      !shouldAttachFragmentToPrevious(fragment) &&
      !shouldPreviousFragmentAbsorbSpace(previousFragment);

    displayFragments.push(needsLeadingSpace ? ` ${fragment}` : fragment);
  }

  return displayFragments;
};

const buildCueTextFromFragments = (fragments: string[]): string | null => {
  const displayFragments = buildDisplayFragments(fragments);
  const text = displayFragments.join("").trim();
  return text.length > 0 ? text : null;
};

const buildCueWithSegments = (
  cueStartMs: number,
  cueEndMs: number,
  segments: Array<{ text: string; offsetMs: number | null }>
): TranscriptCue | null => {
  const usableSegments = segments.filter(
    (segment) => normalizeTranscriptFragment(segment.text).length > 0
  );

  if (usableSegments.length === 0) {
    return null;
  }

  const displayFragments = buildDisplayFragments(usableSegments.map((segment) => segment.text));
  const cueText = displayFragments.join("").trim();

  if (cueText.length === 0) {
    return null;
  }

  if (usableSegments.length === 1) {
    return {
      startMs: cueStartMs,
      endMs: cueEndMs,
      text: cueText
    };
  }

  const mergedSegments: TranscriptSegment[] = [];
  let currentStartMs = cueStartMs;

  for (let index = 0; index < usableSegments.length; index += 1) {
    const segment = usableSegments[index]!;
    const segmentStartMs =
      index === 0
        ? cueStartMs + Math.max(0, segment.offsetMs ?? 0)
        : segment.offsetMs === null
          ? currentStartMs
          : cueStartMs + Math.max(0, segment.offsetMs);
    const text = displayFragments[index] ?? normalizeTranscriptFragment(segment.text);

    currentStartMs = Math.max(currentStartMs, segmentStartMs);

    const previousSegment = mergedSegments[mergedSegments.length - 1];
    if (previousSegment && previousSegment.startMs === currentStartMs) {
      previousSegment.text += text;
      continue;
    }

    mergedSegments.push({
      startMs: currentStartMs,
      endMs: cueEndMs,
      text
    });
  }

  for (let index = 0; index < mergedSegments.length - 1; index += 1) {
    mergedSegments[index]!.endMs = Math.max(
      mergedSegments[index]!.startMs,
      mergedSegments[index + 1]!.startMs
    );
  }

  const segmentsForCue =
    mergedSegments.length > 1
      ? mergedSegments.filter((segment) => segment.endMs >= segment.startMs)
      : [];

  return {
    startMs: cueStartMs,
    endMs: cueEndMs,
    text: cueText,
    ...(segmentsForCue.length > 1 ? { segments: segmentsForCue } : {})
  };
};

const extendCueEnds = (cues: TranscriptCue[]): TranscriptCue[] => {
  for (let index = 0; index < cues.length - 1; index += 1) {
    const cue = cues[index];
    const nextStart = cues[index + 1]?.startMs;

    if (!cue || typeof nextStart !== "number") {
      continue;
    }

    cue.endMs = Math.max(cue.endMs, nextStart);

    const lastSegment = cue.segments?.[cue.segments.length - 1];
    if (lastSegment) {
      lastSegment.endMs = Math.max(lastSegment.endMs, cue.endMs);
    }
  }

  return cues;
};

export const parseTranscriptEvents = (payload: unknown): TranscriptCue[] => {
  const events = getArray(payload, "events");
  const cues = events.flatMap((event): TranscriptCue[] => {
    const startMs = getNumber(event, "tStartMs");
    const durationMs = getNumber(event, "dDurationMs") ?? 0;
    const segments = getArray(event, "segs");

    if (startMs === null || segments.length === 0) {
      return [];
    }

    const cue = buildCueWithSegments(
      startMs,
      startMs + Math.max(durationMs, 250),
      segments.map((segment) => ({
        text: getString(segment, "utf8") ?? "",
        offsetMs: getNumber(segment, "tOffsetMs")
      }))
    );

    if (!cue) {
      return [];
    }

    return [cue];
  });
  return extendCueEnds(cues);
};

export const parseXmlTranscript = (payload: string): TranscriptCue[] => {
  const cues: TranscriptCue[] = [];
  const normalized = normalizeTranscriptPayload(payload);
  const elementPattern = /<(p|text)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

  for (const match of normalized.matchAll(elementPattern)) {
    const attributes = match[2] ?? "";
    const body = match[3] ?? "";
    const startMs =
      parseIntegerMs(attributes.match(/\bt="([^"]+)"/i)?.[1] ?? null) ??
      parseSecondsToMs(attributes.match(/\bstart="([^"]+)"/i)?.[1] ?? null);
    const durationMs =
      parseIntegerMs(attributes.match(/\bd="([^"]+)"/i)?.[1] ?? null) ??
      parseSecondsToMs(attributes.match(/\bdur="([^"]+)"/i)?.[1] ?? null) ??
      0;

    if (startMs === null) {
      continue;
    }

    const cueEndMs = startMs + Math.max(durationMs, 250);
    const segmentPattern = /<s\b([^>]*)>([\s\S]*?)<\/s>/gi;
    const timedSegments = Array.from(body.matchAll(segmentPattern), (segmentMatch) => {
      const segmentAttributes = segmentMatch[1] ?? "";
      const segmentBody = segmentMatch[2] ?? "";
      const rawSegmentStartMs =
        parseIntegerMs(segmentAttributes.match(/\bt="([^"]+)"/i)?.[1] ?? null) ??
        parseSecondsToMs(segmentAttributes.match(/\bstart="([^"]+)"/i)?.[1] ?? null);
      const segmentStartMs =
        rawSegmentStartMs === null
          ? null
          : rawSegmentStartMs >= startMs && rawSegmentStartMs <= cueEndMs + 1000
            ? rawSegmentStartMs - startMs
            : rawSegmentStartMs;

      return {
        text: decodeXmlEntities(stripMarkup(segmentBody)),
        offsetMs: segmentStartMs
      };
    });
    const cue =
      buildCueWithSegments(startMs, cueEndMs, timedSegments) ??
      (() => {
        const text = buildCueTextFromFragments([decodeXmlEntities(stripMarkup(body))]);

        if (!text) {
          return null;
        }

        return {
          startMs,
          endMs: cueEndMs,
          text
        } satisfies TranscriptCue;
      })();

    if (!cue) {
      continue;
    }

    cues.push(cue);
  }

  return extendCueEnds(cues);
};

const parseVttTimestampMs = (value: string): number | null => {
  const trimmed = value.trim();
  const parts = trimmed.split(":");

  if (parts.length < 2 || parts.length > 3) {
    return null;
  }

  const secondsPart = parts.pop();
  const minutesPart = parts.pop();
  const hoursPart = parts.pop() ?? "0";

  if (!secondsPart || !minutesPart) {
    return null;
  }

  const [wholeSecondsText, millisecondsText = "0"] = secondsPart.replace(",", ".").split(".");
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  const seconds = Number(wholeSecondsText);
  const milliseconds = Number(millisecondsText.padEnd(3, "0").slice(0, 3));

  if (![hours, minutes, seconds, milliseconds].every(Number.isFinite)) {
    return null;
  }

  return (((hours * 60) + minutes) * 60 + seconds) * 1000 + milliseconds;
};

export const parseVttTranscript = (payload: string): TranscriptCue[] => {
  const normalized = normalizeTranscriptPayload(payload).replace(/\r/g, "");
  const blocks = normalized.split(/\n{2,}/);
  const cues: TranscriptCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const timingIndex = lines.findIndex((line) => line.includes("-->"));

    if (timingIndex === -1) {
      continue;
    }

    const [startText, endText] = lines[timingIndex]!.split("-->").map((part) => part.trim());
    const startMs = parseVttTimestampMs(startText);
    const endMs = parseVttTimestampMs(endText.split(/\s+/)[0] ?? "");

    if (startMs === null || endMs === null) {
      continue;
    }

    const text = buildCueTextFromFragments(lines.slice(timingIndex + 1));

    if (!text) {
      continue;
    }

    cues.push({
      startMs,
      endMs: Math.max(endMs, startMs + 250),
      text
    });
  }

  return cues;
};

export const parseTranscriptText = (payload: string): TranscriptCue[] => {
  const normalized = normalizeTranscriptPayload(payload);

  if (normalized.length === 0) {
    return [];
  }

  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    try {
      return parseTranscriptEvents(JSON.parse(normalized) as unknown);
    } catch {
      return [];
    }
  }

  if (normalized.startsWith("WEBVTT") || normalized.includes("-->")) {
    return parseVttTranscript(normalized);
  }

  if (normalized.startsWith("<")) {
    return parseXmlTranscript(normalized);
  }

  return [];
};
