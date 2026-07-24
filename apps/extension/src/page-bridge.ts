import {
  PAGE_BRIDGE_CAPTION_TRACKS_EVENT,
  PAGE_BRIDGE_TIMEDTEXT_OBSERVED_EVENT,
  PAGE_BRIDGE_TRANSCRIPT_REQUEST_EVENT,
  PAGE_BRIDGE_TRANSCRIPT_RESPONSE_EVENT
} from "./page-bridge-events";
import type {
  CaptionTrackDescriptor,
  CaptionTracksEventDetail,
  TimedtextObservedEventDetail,
  TranscriptRequestEventDetail,
  TranscriptResponseEventDetail
} from "./types";

const GLOBAL_FLAG = "__ytSubCompanionPageBridgeLoaded";
const POLL_INTERVAL_MS = 1000;

type MoviePlayerElement = HTMLElement & {
  getPlayerResponse?: () => unknown;
  getOption?: (namespace: string, key: string) => unknown;
};

type InstrumentedXmlHttpRequest = XMLHttpRequest & {
  __ytSubCompanionTimedtextUrl?: string;
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

const getVideoId = (): string | null => {
  if (location.pathname !== "/watch") {
    return null;
  }

  return new URL(location.href).searchParams.get("v");
};

const getVideoIdFromUrl = (url: string): string | null => {
  try {
    return new URL(url, location.origin).searchParams.get("v");
  } catch {
    return null;
  }
};

const normalizeTranscriptPayload = (value: string): string =>
  value
    .replace(/^\uFEFF/, "")
    .replace(/^\)\]\}'\s*/, "")
    .trim();

const isTimedtextUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url, location.origin);
    return parsed.pathname.includes("/api/timedtext");
  } catch {
    return false;
  }
};

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

const normalizeTrack = (track: unknown): CaptionTrackDescriptor | null => {
  const baseUrl = getString(track, "baseUrl");

  if (!baseUrl) {
    return null;
  }

  return {
    baseUrl,
    kind: getString(track, "kind"),
    languageCode: getString(track, "languageCode"),
    vssId: getString(track, "vssId")
  };
};

const resolveCaptionTracks = (value: unknown): CaptionTrackDescriptor[] => {
  const captions = getRecord(value, "captions");
  const renderer = getRecord(captions, "playerCaptionsTracklistRenderer");
  const captionTracks = getArray(renderer, "captionTracks");

  return captionTracks.flatMap((track): CaptionTrackDescriptor[] => {
    const normalized = normalizeTrack(track);
    return normalized ? [normalized] : [];
  });
};

const resolveTracklistCaptionTracks = (value: unknown): CaptionTrackDescriptor[] => {
  const tracklist = getRecord(value, "trackData");
  const captionTracks = getArray(tracklist ?? value, "captionTracks");

  return captionTracks.flatMap((track): CaptionTrackDescriptor[] => {
    const normalized = normalizeTrack(track);
    return normalized ? [normalized] : [];
  });
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

const readGlobalPlayerResponse = (): unknown => {
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

  return parsePlayerResponseJson(rawPlayerResponse);
};

const readWatchFlexyPlayerResponse = (): unknown => {
  const watchFlexy = document.querySelector("ytd-watch-flexy");

  if (!watchFlexy) {
    return null;
  }

  return (
    getReflectValue(watchFlexy, "playerResponse") ??
    getReflectValue(watchFlexy, "playerData") ??
    getRecord(getReflectValue(watchFlexy, "data"), "playerResponse")
  );
};

const readMoviePlayerData = (): CaptionTrackDescriptor[] => {
  const moviePlayer = document.getElementById("movie_player") as MoviePlayerElement | null;

  if (!moviePlayer) {
    return [];
  }

  if (typeof moviePlayer.getPlayerResponse === "function") {
    const playerResponseTracks = resolveCaptionTracks(moviePlayer.getPlayerResponse());

    if (playerResponseTracks.length > 0) {
      return playerResponseTracks;
    }
  }

  if (typeof moviePlayer.getOption === "function") {
    const tracklistTracks = resolveTracklistCaptionTracks(
      moviePlayer.getOption("captions", "tracklist")
    );

    if (tracklistTracks.length > 0) {
      return tracklistTracks;
    }
  }

  return [];
};

const readCaptionTracks = (): CaptionTrackDescriptor[] => {
  const fromMoviePlayer = readMoviePlayerData();

  if (fromMoviePlayer.length > 0) {
    return fromMoviePlayer;
  }

  const fromGlobalResponse = resolveCaptionTracks(readGlobalPlayerResponse());

  if (fromGlobalResponse.length > 0) {
    return fromGlobalResponse;
  }

  return resolveCaptionTracks(readWatchFlexyPlayerResponse());
};

const dispatchCaptionTracks = (detail: CaptionTracksEventDetail): void => {
  window.dispatchEvent(
    new CustomEvent<CaptionTracksEventDetail>(PAGE_BRIDGE_CAPTION_TRACKS_EVENT, {
      detail
    })
  );
};

const dispatchTranscriptResponse = (detail: TranscriptResponseEventDetail): void => {
  window.dispatchEvent(
    new CustomEvent<TranscriptResponseEventDetail>(PAGE_BRIDGE_TRANSCRIPT_RESPONSE_EVENT, {
      detail
    })
  );
};

const dispatchTimedtextObserved = (detail: TimedtextObservedEventDetail): void => {
  window.dispatchEvent(
    new CustomEvent<TimedtextObservedEventDetail>(PAGE_BRIDGE_TIMEDTEXT_OBSERVED_EVENT, {
      detail
    })
  );
};

const bootstrap = (): void => {
  const bridgeWindow = window as Window & typeof globalThis & Record<string, unknown>;

  if (bridgeWindow[GLOBAL_FLAG]) {
    return;
  }

  bridgeWindow[GLOBAL_FLAG] = true;
  let lastPayload = "";
  const originalFetch = window.fetch.bind(window);
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);

    try {
      const requestInput = args[0];
      const requestUrl =
        typeof requestInput === "string"
          ? requestInput
          : requestInput instanceof Request
            ? requestInput.url
            : "";
      const responseUrl = response.url || requestUrl;

      if (response.ok && responseUrl && isTimedtextUrl(responseUrl)) {
        const body = await response.clone().text();

        if (normalizeTranscriptPayload(body).length > 0) {
          dispatchTimedtextObserved({
            videoId: getVideoIdFromUrl(responseUrl) ?? getVideoId(),
            url: responseUrl,
            body,
            source: "fetch"
          });
        }
      }
    } catch {
      return response;
    }

    return response;
  };

  XMLHttpRequest.prototype.open = function (
    this: InstrumentedXmlHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ): void {
    this.__ytSubCompanionTimedtextUrl = String(url);
    originalXhrOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
  };

  XMLHttpRequest.prototype.send = function (
    this: InstrumentedXmlHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null
  ): void {
    this.addEventListener(
      "load",
      () => {
        const responseUrl = this.responseURL || this.__ytSubCompanionTimedtextUrl || "";

        if (!responseUrl || !isTimedtextUrl(responseUrl) || this.status < 200 || this.status >= 300) {
          return;
        }

        const responseText = typeof this.responseText === "string" ? this.responseText : "";

        if (normalizeTranscriptPayload(responseText).length === 0) {
          return;
        }

        dispatchTimedtextObserved({
          videoId: getVideoIdFromUrl(responseUrl) ?? getVideoId(),
          url: responseUrl,
          body: responseText,
          source: "xhr"
        });
      },
      { once: true }
    );

    originalXhrSend.call(this, body);
  };

  const respondToTranscriptRequest = async (detail: TranscriptRequestEventDetail): Promise<void> => {
    let lastError: string | null = null;

    for (const transcriptUrl of buildTranscriptUrls(detail.baseUrl)) {
      try {
        const response = await fetch(transcriptUrl, {
          credentials: "include"
        });

        if (!response.ok) {
          lastError = `HTTP ${response.status}`;
          continue;
        }

        const body = await response.text();

        if (normalizeTranscriptPayload(body).length === 0) {
          lastError = "Empty transcript payload";
          continue;
        }

        dispatchTranscriptResponse({
          requestId: detail.requestId,
          videoId: detail.videoId,
          url: transcriptUrl,
          body,
          error: null
        });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    dispatchTranscriptResponse({
      requestId: detail.requestId,
      videoId: detail.videoId,
      url: null,
      body: null,
      error: lastError ?? "Transcript request failed"
    });
  };

  const emitTracks = (source: string): void => {
    const detail: CaptionTracksEventDetail = {
      videoId: getVideoId(),
      source,
      tracks: readCaptionTracks()
    };
    const nextPayload = JSON.stringify(detail);

    if (source !== "interval" && nextPayload === lastPayload) {
      return;
    }

    lastPayload = nextPayload;
    dispatchCaptionTracks(detail);
  };

  emitTracks("bootstrap");
  window.addEventListener("yt-navigate-finish", () => {
    emitTracks("yt-navigate-finish");
  });
  window.addEventListener("popstate", () => {
    emitTracks("popstate");
  });
  document.addEventListener("visibilitychange", () => {
    emitTracks("visibilitychange");
  });
  window.addEventListener(PAGE_BRIDGE_TRANSCRIPT_REQUEST_EVENT, (event: Event) => {
    const detail = (event as CustomEvent<TranscriptRequestEventDetail>).detail;

    if (
      !detail ||
      typeof detail.requestId !== "string" ||
      typeof detail.videoId !== "string" ||
      typeof detail.baseUrl !== "string"
    ) {
      return;
    }

    void respondToTranscriptRequest(detail);
  });
  window.setInterval(() => {
    emitTracks("interval");
  }, POLL_INTERVAL_MS);
};

bootstrap();
