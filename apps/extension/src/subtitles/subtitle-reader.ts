import { extensionLogger } from "../logger";
import type {
  CaptionTrackDescriptor,
  SubtitleContext,
  SubtitlePayload,
  SubtitleReader,
  TimedtextObservedEventDetail
} from "../types";
import {
  readPlayerResponse,
  resolveCaptionTracks,
  selectCaptionTrack
} from "./caption-track-selector";
import { readDomSubtitle } from "./dom-caption-source";
import {
  buildTranscriptUrls,
  normalizeTranscriptPayload,
  parseTranscriptText
} from "./transcript-parsers";
import { readTextTrackSubtitle } from "./text-track-source";

const subtitlePollIntervalMs = 250;
const transcriptRetryIntervalMs = 5_000;

type TranscriptCue = ReturnType<typeof parseTranscriptText>[number];

type TranscriptRequestResult = {
  url: string | null;
  body: string | null;
  error: string | null;
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
