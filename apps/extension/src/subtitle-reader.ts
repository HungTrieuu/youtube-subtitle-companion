import type { SubtitleTimelineCue } from "@youtube-subtitle-companion/shared";

import { extensionLogger } from "./logger";
import type {
  CaptionTrackDescriptor,
  SubtitleContext,
  SubtitlePayload,
  TimedtextObservedEventDetail,
  SubtitleReader
} from "./types";

const CAPTION_SEGMENT_SELECTORS = [
  ".ytp-caption-segment",
  ".captions-text .ytp-caption-segment",
  ".caption-window .ytp-caption-segment"
] as const;

const CAPTION_BLOCK_SELECTORS = [
  ".ytp-caption-window-container .captions-text",
  ".ytp-caption-window-container .caption-window",
  ".caption-window"
] as const;
const subtitlePollIntervalMs = 250;
const transcriptRetryIntervalMs = 5_000;
const XML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " "
};

type TranscriptCue = SubtitleTimelineCue;

type TranscriptRequestResult = {
  url: string | null;
  body: string | null;
  error: string | null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const getRecord = (value: unknown, key: string): Record<string, unknown> | null => {
  const record = asRecord(value);
  return record ? asRecord(record[key]) : null;
};

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

const resolveCaptionTracks = (playerResponse: unknown): CaptionTrackDescriptor[] => {
  const captions = getRecord(playerResponse, "captions");
  const renderer = getRecord(captions, "playerCaptionsTracklistRenderer");
  const tracks = getArray(renderer, "captionTracks");

  return tracks.flatMap((track): CaptionTrackDescriptor[] => {
    const baseUrl = getString(track, "baseUrl");

    if (!baseUrl) {
      return [];
    }

    return [
      {
        baseUrl,
        kind: getString(track, "kind"),
        languageCode: getString(track, "languageCode"),
        vssId: getString(track, "vssId")
      }
    ];
  });
};

const selectCaptionTrack = (tracks: CaptionTrackDescriptor[]): CaptionTrackDescriptor | null => {
  if (tracks.length === 0) {
    return null;
  }

  const sorted = [...tracks].sort((left, right) => {
    const leftIsManual = left.kind !== "asr";
    const rightIsManual = right.kind !== "asr";

    if (leftIsManual !== rightIsManual) {
      return leftIsManual ? -1 : 1;
    }

    return 0;
  });

  return sorted[0] ?? null;
};

const parsePlayerResponseJson = (value: string | null): unknown => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const getReflectValue = (target: object | null, key: string): unknown => {
  if (!target) {
    return null;
  }

  try {
    return Reflect.get(target, key);
  } catch {
    return null;
  }
};

const readPlayerResponse = (): unknown => {
  const globalWindow = window as Window &
    typeof globalThis & {
      ytInitialPlayerResponse?: unknown;
      ytplayer?: {
        config?: {
          args?: Record<string, string | undefined>;
        };
      };
    };

  if (globalWindow.ytInitialPlayerResponse) {
    return globalWindow.ytInitialPlayerResponse;
  }

  const args = globalWindow.ytplayer?.config?.args;
  const rawPlayerResponse =
    typeof args?.raw_player_response === "string"
      ? args.raw_player_response
      : typeof args?.player_response === "string"
        ? args.player_response
        : null;
  const parsedArgsResponse = parsePlayerResponseJson(rawPlayerResponse);

  if (parsedArgsResponse) {
    return parsedArgsResponse;
  }

  const watchFlexy = document.querySelector("ytd-watch-flexy");
  if (!watchFlexy) {
    return null;
  }

  const playerResponse =
    getReflectValue(watchFlexy, "playerResponse") ??
    getReflectValue(watchFlexy, "playerData") ??
    getReflectValue(watchFlexy, "data");

  if (playerResponse) {
    return playerResponse;
  }

  const watchFlexyData = asRecord(getReflectValue(watchFlexy, "data"));
  return watchFlexyData?.playerResponse ?? null;
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

const buildTranscriptUrls = (baseUrl: string): string[] => {
  const url = new URL(baseUrl, location.origin);
  const candidates = [url.toString()];

  for (const fmt of ["json3", "srv3", "vtt"]) {
    const variant = new URL(url.toString());
    variant.searchParams.set("fmt", fmt);
    candidates.push(variant.toString());
  }

  return [...new Set(candidates)];
};

const normalizeTranscriptPayload = (value: string): string =>
  value
    .replace(/^\uFEFF/, "")
    .replace(/^\)\]\}'\s*/, "")
    .trim();

export const parseTranscriptEvents = (payload: unknown): TranscriptCue[] => {
  const events = getArray(payload, "events");
  const cues = events.flatMap((event): TranscriptCue[] => {
    const startMs = getNumber(event, "tStartMs");
    const durationMs = getNumber(event, "dDurationMs") ?? 0;
    const segments = getArray(event, "segs");

    if (startMs === null || segments.length === 0) {
      return [];
    }

    const text = normalizeSubtitleText(
      segments
        .map((segment) => getString(segment, "utf8") ?? "")
        .join("")
    );

    if (text.length === 0) {
      return [];
    }

    return [
      {
        startMs,
        endMs: startMs + Math.max(durationMs, 250),
        text
      }
    ];
  });

  for (let index = 0; index < cues.length - 1; index += 1) {
    const nextStart = cues[index + 1]?.startMs;

    if (typeof nextStart === "number") {
      cues[index]!.endMs = Math.max(cues[index]!.endMs, nextStart);
    }
  }

  return cues;
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

    const text = normalizeSubtitleText(decodeXmlEntities(stripMarkup(body)));

    if (text.length === 0) {
      continue;
    }

    cues.push({
      startMs,
      endMs: startMs + Math.max(durationMs, 250),
      text
    });
  }

  for (let index = 0; index < cues.length - 1; index += 1) {
    const nextStart = cues[index + 1]?.startMs;

    if (typeof nextStart === "number") {
      cues[index]!.endMs = Math.max(cues[index]!.endMs, nextStart);
    }
  }

  return cues;
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

    const text = normalizeSubtitleText(lines.slice(timingIndex + 1).join(" "));

    if (text.length === 0) {
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

export const normalizeSubtitleText = (value: string): string =>
  value
    .replace(/\s+/g, " ")
    .trim();

export const mergeCaptionSegments = (segments: string[]): string | null => {
  const compactSegments = segments
    .map(normalizeSubtitleText)
    .filter((segment, index, list) => segment.length > 0 && segment !== list[index - 1]);

  if (compactSegments.length === 0) {
    return null;
  }

  return normalizeSubtitleText(compactSegments.join(" "));
};

const readDomSubtitle = (): string | null => {
  const segments = CAPTION_SEGMENT_SELECTORS.flatMap((selector) =>
    Array.from(document.querySelectorAll<HTMLElement>(selector), (segment): string => {
      return segment.textContent ?? "";
    })
  );

  const mergedSegments = mergeCaptionSegments(segments);
  if (mergedSegments) {
    return mergedSegments;
  }

  for (const selector of CAPTION_BLOCK_SELECTORS) {
    const blockText = normalizeSubtitleText(
      Array.from(document.querySelectorAll<HTMLElement>(selector), (element): string => {
        return element.textContent ?? "";
      }).join(" ")
    );

    if (blockText.length > 0) {
      return blockText;
    }
  }

  return null;
};

const readCueText = (cue: TextTrackCue): string | null => {
  if ("text" in cue && typeof cue.text === "string") {
    const normalized = normalizeSubtitleText(cue.text);
    return normalized.length > 0 ? normalized : null;
  }

  return null;
};

const readTextTrackSubtitle = (video: HTMLVideoElement | null): string | null => {
  if (!video) {
    return null;
  }

  const cueTexts: string[] = [];

  for (let index = 0; index < video.textTracks.length; index += 1) {
    const track = video.textTracks[index];

    if (!track || track.mode === "disabled") {
      continue;
    }

    const activeCues = track.activeCues;
    if (!activeCues) {
      continue;
    }

    for (let cueIndex = 0; cueIndex < activeCues.length; cueIndex += 1) {
      const cue = activeCues[cueIndex];

      if (!cue) {
        continue;
      }

      const cueText = readCueText(cue);
      if (cueText) {
        cueTexts.push(cueText);
      }
    }
  }

  return mergeCaptionSegments(cueTexts);
};

export class YouTubeDomSubtitleReader implements SubtitleReader {
  private readonly observer = new MutationObserver(() => {
    this.bindVideoListeners();
    this.scheduleFlush();
  });
  private readonly navigationListener = () => {
    this.reset();
  };
  private readonly videoListener = () => {
    this.bindVideoListeners();
    this.scheduleFlush();
  };
  private readonly textTrackListListener = () => {
    this.attachCueListeners();
    this.scheduleFlush();
  };
  private readonly cueChangeListener = () => {
    this.scheduleFlush();
  };
  private readonly visibilityListener = () => {
    this.scheduleFlush();
  };
  private onSubtitle: ((subtitle: SubtitlePayload | null) => void) | null = null;
  private lastEmittedText: string | null = null;
  private flushTimer: number | null = null;
  private pollTimer: number | null = null;
  private video: HTMLVideoElement | null = null;
  private transcriptVideoId: string | null = null;
  private transcriptCues: TranscriptCue[] = [];
  private transcriptCueIndex = 0;
  private transcriptFetchPromise: Promise<void> | null = null;
  private transcriptRefreshRequested = false;
  private lastTranscriptAttemptAt = 0;

  public constructor(
    private readonly getContext: () => SubtitleContext | null,
    private readonly getVideo: () => HTMLVideoElement | null = () =>
      document.querySelector<HTMLVideoElement>("video"),
    private readonly getCaptionTracks: () => CaptionTrackDescriptor[] = () => [],
    private readonly requestTranscriptFromPage:
      | ((videoId: string, track: CaptionTrackDescriptor) => Promise<TranscriptRequestResult>)
      | null = null
  ) {}

  public start(onSubtitle: (subtitle: SubtitlePayload | null) => void): void {
    this.onSubtitle = onSubtitle;
    this.bindVideoListeners();
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    window.addEventListener("yt-navigate-finish", this.navigationListener);
    window.addEventListener("popstate", this.navigationListener);
    document.addEventListener("visibilitychange", this.visibilityListener);
    this.pollTimer = window.setInterval(() => {
      this.flush();
    }, subtitlePollIntervalMs);
    this.flush(true);
  }

  public stop(): void {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.observer.disconnect();
    this.unbindVideoListeners();
    window.removeEventListener("yt-navigate-finish", this.navigationListener);
    window.removeEventListener("popstate", this.navigationListener);
    document.removeEventListener("visibilitychange", this.visibilityListener);
    this.onSubtitle = null;
  }

  public notifyCaptionTracksUpdated(): void {
    this.lastTranscriptAttemptAt = 0;

    if (this.transcriptCues.length === 0) {
      if (this.transcriptFetchPromise !== null) {
        this.transcriptRefreshRequested = true;
        return;
      }

      this.flush();
    }
  }

  public notifyPlaybackStateChanged(): void {
    this.flush();
  }

  public ingestObservedTranscript(detail: TimedtextObservedEventDetail): void {
    const context = this.getContext();
    const activeVideoId = context?.videoId ?? this.transcriptVideoId;

    if (detail.videoId && activeVideoId && detail.videoId !== activeVideoId) {
      return;
    }

    const transcriptCues = parseTranscriptText(detail.body);

    if (transcriptCues.length === 0) {
      return;
    }

    this.transcriptVideoId = detail.videoId ?? activeVideoId ?? this.transcriptVideoId;
    this.transcriptCues = transcriptCues;
    this.transcriptCueIndex = 0;
    this.lastTranscriptAttemptAt = Date.now();
    this.lastEmittedText = null;

    extensionLogger.debug("Transcript fallback loaded", {
      videoId: this.transcriptVideoId,
      cues: this.transcriptCues.length,
      url: detail.url,
      source: `page-network-${detail.source}`
    });
    this.flush();
  }

  public reset(): void {
    this.lastEmittedText = null;
    this.transcriptCueIndex = 0;
    this.flush(true);
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) {
      return;
    }

    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 0);
  }

  private flush(force = false): void {
    this.bindVideoListeners();
    const context = this.getContext();
    this.ensureTranscriptForContext(context);
    const nextText =
      readDomSubtitle() ??
      readTextTrackSubtitle(this.video) ??
      this.readTranscriptSubtitle(context);

    if (!force && nextText === this.lastEmittedText) {
      return;
    }

    this.lastEmittedText = nextText;

    if (nextText && context) {
      this.onSubtitle?.({
        text: nextText,
        currentTime: context.currentTime,
        videoId: context.videoId
      });
      return;
    }

    this.onSubtitle?.(null);
  }

  private ensureTranscriptForContext(context: SubtitleContext | null): void {
    if (!context) {
      this.transcriptVideoId = null;
      this.transcriptCues = [];
      this.transcriptCueIndex = 0;
      return;
    }

    if (context.videoId !== this.transcriptVideoId) {
      this.transcriptVideoId = context.videoId;
      this.transcriptCues = [];
      this.transcriptCueIndex = 0;
      this.lastTranscriptAttemptAt = 0;
    }

    if (this.transcriptFetchPromise !== null) {
      return;
    }

    if (this.transcriptCues.length > 0) {
      return;
    }

    const now = Date.now();

    if (now - this.lastTranscriptAttemptAt < transcriptRetryIntervalMs) {
      return;
    }

    this.lastTranscriptAttemptAt = now;
    this.transcriptFetchPromise = this.loadTranscript(context.videoId).finally(() => {
      this.transcriptFetchPromise = null;

      if (this.transcriptRefreshRequested) {
        this.transcriptRefreshRequested = false;
        this.scheduleFlush();
      }
    });
  }

  private async loadTranscript(videoId: string): Promise<void> {
    const bridgedTracks = this.getCaptionTracks();
    const playerResponse = bridgedTracks.length > 0 ? null : readPlayerResponse();
    const track = selectCaptionTrack(
      bridgedTracks.length > 0 ? bridgedTracks : resolveCaptionTracks(playerResponse)
    );

    if (!track) {
      extensionLogger.debug("No caption track available for transcript fallback", {
        videoId,
        bridgedTracks: bridgedTracks.length
      });
      return;
    }

    try {
      if (this.requestTranscriptFromPage) {
        const pageTranscript = await this.requestTranscriptFromPage(videoId, track);

        if (pageTranscript.body) {
          const transcriptCues = parseTranscriptText(pageTranscript.body);

          if (transcriptCues.length > 0) {
            if (this.transcriptVideoId !== videoId) {
              return;
            }

            this.transcriptCues = transcriptCues;
            this.transcriptCueIndex = 0;

            extensionLogger.debug("Transcript fallback loaded", {
              videoId,
              cues: this.transcriptCues.length,
              languageCode: track.languageCode,
              kind: track.kind,
              url: pageTranscript.url,
              source: "page-bridge"
            });
            this.scheduleFlush();
            return;
          }

          extensionLogger.debug("Transcript payload from page bridge was unsupported", {
            videoId,
            url: pageTranscript.url,
            preview: normalizeTranscriptPayload(pageTranscript.body).slice(0, 120)
          });
        } else if (pageTranscript.error) {
          extensionLogger.debug("Page bridge transcript request did not return a body", {
            videoId,
            error: pageTranscript.error
          });
        }
      }

      for (const transcriptUrl of buildTranscriptUrls(track.baseUrl)) {
        const response = await fetch(transcriptUrl, {
          credentials: "include"
        });

        if (!response.ok) {
          continue;
        }

        const responseText = await response.text();
        const transcriptCues = parseTranscriptText(responseText);

        if (transcriptCues.length === 0) {
          extensionLogger.debug("Transcript payload was empty or unsupported", {
            videoId,
            url: transcriptUrl,
            preview: normalizeTranscriptPayload(responseText).slice(0, 120)
          });
          continue;
        }

        if (this.transcriptVideoId !== videoId) {
          return;
        }

        this.transcriptCues = transcriptCues;
        this.transcriptCueIndex = 0;

        extensionLogger.debug("Transcript fallback loaded", {
          videoId,
          cues: this.transcriptCues.length,
          languageCode: track.languageCode,
          kind: track.kind,
          url: transcriptUrl,
          source: "content-fetch"
        });
        this.scheduleFlush();
        return;
      }

      extensionLogger.warn("Transcript fetch failed", {
        videoId,
        trackKind: track.kind,
        languageCode: track.languageCode
      });
    } catch (error) {
      extensionLogger.warn("Transcript fetch threw an error", {
        videoId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private readTranscriptSubtitle(context: SubtitleContext | null): string | null {
    if (!context || this.transcriptCues.length === 0) {
      return null;
    }

    const currentMs = context.currentTime * 1000;
    let index = Math.min(this.transcriptCueIndex, Math.max(this.transcriptCues.length - 1, 0));

    while (index > 0 && this.transcriptCues[index]!.startMs > currentMs) {
      index -= 1;
    }

    while (
      index < this.transcriptCues.length &&
      this.transcriptCues[index]!.endMs <= currentMs
    ) {
      index += 1;
    }

    this.transcriptCueIndex = index;
    const cue = this.transcriptCues[index];

    if (!cue) {
      return null;
    }

    if (cue.startMs <= currentMs && currentMs < cue.endMs) {
      return cue.text;
    }

    return null;
  }

  private bindVideoListeners(): void {
    const nextVideo = this.getVideo();

    if (nextVideo === this.video) {
      this.attachCueListeners();
      return;
    }

    this.unbindVideoListeners();
    this.video = nextVideo;

    if (!this.video) {
      return;
    }

    this.video.addEventListener("loadedmetadata", this.videoListener);
    this.video.addEventListener("timeupdate", this.videoListener);
    this.video.addEventListener("seeked", this.videoListener);
    this.video.addEventListener("emptied", this.videoListener);
    this.video.textTracks.addEventListener("addtrack", this.textTrackListListener);
    this.video.textTracks.addEventListener("removetrack", this.textTrackListListener);
    this.video.textTracks.addEventListener("change", this.textTrackListListener);
    this.attachCueListeners();
  }

  private unbindVideoListeners(): void {
    if (!this.video) {
      return;
    }

    this.detachCueListeners(this.video);
    this.video.removeEventListener("loadedmetadata", this.videoListener);
    this.video.removeEventListener("timeupdate", this.videoListener);
    this.video.removeEventListener("seeked", this.videoListener);
    this.video.removeEventListener("emptied", this.videoListener);
    this.video.textTracks.removeEventListener("addtrack", this.textTrackListListener);
    this.video.textTracks.removeEventListener("removetrack", this.textTrackListListener);
    this.video.textTracks.removeEventListener("change", this.textTrackListListener);
    this.video = null;
  }

  private attachCueListeners(): void {
    if (!this.video) {
      return;
    }

    for (let index = 0; index < this.video.textTracks.length; index += 1) {
      const track = this.video.textTracks[index];
      track?.removeEventListener("cuechange", this.cueChangeListener);
      track?.addEventListener("cuechange", this.cueChangeListener);
    }
  }

  private detachCueListeners(video: HTMLVideoElement): void {
    for (let index = 0; index < video.textTracks.length; index += 1) {
      const track = video.textTracks[index];
      track?.removeEventListener("cuechange", this.cueChangeListener);
    }
  }
}
