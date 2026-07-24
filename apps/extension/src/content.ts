import {
  clampTime,
  createHelloMessage,
  type PlayerStateMessage,
  type SubtitleTimelineCue
} from "@youtube-subtitle-companion/shared";

import { extensionLogger } from "./logger";
import {
  PAGE_BRIDGE_CAPTION_TRACKS_EVENT,
  PAGE_BRIDGE_TIMEDTEXT_OBSERVED_EVENT,
  PAGE_BRIDGE_TRANSCRIPT_REQUEST_EVENT,
  PAGE_BRIDGE_TRANSCRIPT_RESPONSE_EVENT
} from "./page-bridge-events";
import { parseTranscriptText, YouTubeDomSubtitleReader } from "./subtitle-reader";
import type {
  CaptionTrackDescriptor,
  CaptionTracksEventDetail,
  SubtitlePayload,
  TimedtextObservedEventDetail,
  TranscriptRequestEventDetail,
  TranscriptResponseEventDetail
} from "./types";
import { ExtensionWebSocketClient } from "./websocket-client";
import { YouTubePlayerController } from "./youtube-player";

const clientId = crypto.randomUUID();
const websocketUrl = "ws://127.0.0.1:8765";
const PAGE_BRIDGE_SCRIPT_ID = "yt-sub-companion-page-bridge";
const STALE_STATE_TOLERANCE_SECONDS = 0.75;
const SEEK_BACKWARD_THRESHOLD_SECONDS = 2;

let latestState: PlayerStateMessage | null = null;
let latestSubtitle: SubtitlePayload | null = null;
let lastLoggedVideoId: string | null = null;
let lastLoggedPlaying: boolean | null = null;
let lastLoggedTitle: string | null = null;
let hasLoggedSubtitleForVideo = false;
let latestCaptionTracks: CaptionTrackDescriptor[] = [];
let transcriptRequestCounter = 0;
let hasLoggedObservedTimedtext = false;
let lastLoggedStaleStateAt = 0;
let lastLoggedCaptionTrackKey: string | null = null;
let lastSentTranscriptTimelineKey: string | null = null;
let latestTranscriptTimeline:
  | {
      videoId: string;
      cues: SubtitleTimelineCue[];
    }
  | null = null;

const pendingTranscriptRequests = new Map<
  string,
  {
    resolve(result: { url: string | null; body: string | null; error: string | null }): void;
    timeoutId: number;
  }
>();

const deriveStateAt = (state: PlayerStateMessage, now = Date.now()): PlayerStateMessage => {
  if (!state.playing) {
    return state;
  }

  const elapsedSeconds = Math.max(0, (now - state.timestamp) / 1000);
  const derivedCurrentTime = clampTime(
    state.currentTime + elapsedSeconds * state.playbackRate,
    state.duration
  );

  return {
    ...state,
    currentTime: derivedCurrentTime
  };
};

const mergePlayerState = (
  previous: PlayerStateMessage | null,
  incoming: PlayerStateMessage
): PlayerStateMessage => {
  if (!previous || previous.videoId !== incoming.videoId) {
    return incoming;
  }

  if (
    !previous.playing ||
    !incoming.playing ||
    previous.playbackRate !== incoming.playbackRate
  ) {
    return incoming;
  }

  const previousDerived = deriveStateAt(previous, incoming.timestamp);

  if (incoming.currentTime <= previous.currentTime - SEEK_BACKWARD_THRESHOLD_SECONDS) {
    return incoming;
  }

  if (incoming.currentTime >= previousDerived.currentTime - STALE_STATE_TOLERANCE_SECONDS) {
    return incoming;
  }

  if (incoming.timestamp - lastLoggedStaleStateAt > 5000) {
    extensionLogger.debug("Ignored stale player heartbeat while extrapolating background time", {
      videoId: incoming.videoId,
      incomingCurrentTime: incoming.currentTime,
      previousCurrentTime: previous.currentTime,
      expectedCurrentTime: previousDerived.currentTime
    });
    lastLoggedStaleStateAt = incoming.timestamp;
  }

  return {
    ...incoming,
    currentTime: previous.currentTime,
    timestamp: previous.timestamp
  };
};

const injectPageBridge = (): void => {
  if (document.getElementById(PAGE_BRIDGE_SCRIPT_ID)) {
    return;
  }

  const script = document.createElement("script");
  script.id = PAGE_BRIDGE_SCRIPT_ID;
  script.src = chrome.runtime.getURL("page-bridge.js");
  script.async = false;
  script.addEventListener("load", () => {
    script.remove();
  });
  script.addEventListener("error", () => {
    extensionLogger.warn("Failed to inject page bridge script");
  });
  (document.head ?? document.documentElement).append(script);
};

window.addEventListener(PAGE_BRIDGE_CAPTION_TRACKS_EVENT, (event: Event) => {
  const detail = (event as CustomEvent<CaptionTracksEventDetail>).detail;

  if (!detail || !Array.isArray(detail.tracks)) {
    return;
  }

  latestCaptionTracks = detail.tracks.filter(
    (track): track is CaptionTrackDescriptor => typeof track?.baseUrl === "string"
  );

  const captionTrackLogKey = `${detail.videoId ?? "none"}:${detail.source}:${latestCaptionTracks.length}`;

  if (detail.source !== "interval" || captionTrackLogKey !== lastLoggedCaptionTrackKey) {
    extensionLogger.debug("Caption track metadata updated", {
      videoId: detail.videoId,
      source: detail.source,
      tracks: latestCaptionTracks.length
    });
    lastLoggedCaptionTrackKey = captionTrackLogKey;
  }

  subtitleReader.notifyCaptionTracksUpdated();
  subtitleReader.notifyPlaybackStateChanged();
});

window.addEventListener(PAGE_BRIDGE_TRANSCRIPT_RESPONSE_EVENT, (event: Event) => {
  const detail = (event as CustomEvent<TranscriptResponseEventDetail>).detail;

  if (!detail || typeof detail.requestId !== "string") {
    return;
  }

  const pending = pendingTranscriptRequests.get(detail.requestId);

  if (!pending) {
    return;
  }

  if (detail.body) {
    publishTranscriptTimeline(detail.videoId, detail.body, "page-bridge-response");
  }

  window.clearTimeout(pending.timeoutId);
  pendingTranscriptRequests.delete(detail.requestId);
  pending.resolve({
    url: detail.url,
    body: detail.body,
    error: detail.error
  });
});

window.addEventListener(PAGE_BRIDGE_TIMEDTEXT_OBSERVED_EVENT, (event: Event) => {
  const detail = (event as CustomEvent<TimedtextObservedEventDetail>).detail;

  if (!detail || typeof detail.url !== "string" || typeof detail.body !== "string") {
    return;
  }

  if (!hasLoggedObservedTimedtext) {
    extensionLogger.debug("Observed timedtext payload from page network", {
      videoId: detail.videoId,
      source: detail.source,
      url: detail.url,
      length: detail.body.length
    });
    hasLoggedObservedTimedtext = true;
  }

  publishTranscriptTimeline(detail.videoId, detail.body, `page-network-${detail.source}`);
  subtitleReader.ingestObservedTranscript(detail);
});

window.addEventListener("yt-navigate-finish", () => {
  injectPageBridge();
});

const playerController = new YouTubePlayerController((state) => {
  const mergedState = mergePlayerState(latestState, state);

  if (
    mergedState.videoId !== lastLoggedVideoId ||
    mergedState.playing !== lastLoggedPlaying ||
    mergedState.title !== lastLoggedTitle
  ) {
    extensionLogger.debug("Player state ready", {
      videoId: mergedState.videoId,
      title: mergedState.title,
      playing: mergedState.playing,
      playbackRate: mergedState.playbackRate,
      currentTime: mergedState.currentTime
    });
    lastLoggedVideoId = mergedState.videoId;
    lastLoggedPlaying = mergedState.playing;
    lastLoggedTitle = mergedState.title;
    hasLoggedSubtitleForVideo = false;
  }

  latestState = mergedState;
  subtitleReader.notifyPlaybackStateChanged();
  websocketClient.send(mergedState);
});

const getDerivedState = (): PlayerStateMessage | null => {
  const state = latestState ?? playerController.getState();

  if (!state) {
    return null;
  }

  return deriveStateAt(state);
};

const requestTranscriptFromPage = (
  videoId: string,
  track: CaptionTrackDescriptor
): Promise<{ url: string | null; body: string | null; error: string | null }> =>
  new Promise((resolve) => {
    const requestId = `${Date.now()}-${transcriptRequestCounter++}`;
    const timeoutId = window.setTimeout(() => {
      pendingTranscriptRequests.delete(requestId);
      resolve({
        url: null,
        body: null,
        error: "Timed out waiting for page transcript response"
      });
    }, 5000);

    pendingTranscriptRequests.set(requestId, {
      resolve,
      timeoutId
    });

    const detail: TranscriptRequestEventDetail = {
      requestId,
      videoId,
      baseUrl: track.baseUrl
    };

    window.dispatchEvent(
      new CustomEvent<TranscriptRequestEventDetail>(PAGE_BRIDGE_TRANSCRIPT_REQUEST_EVENT, {
        detail
      })
    );
  });

const publishTranscriptTimeline = (videoId: string | null, body: string, source: string): void => {
  if (!videoId) {
    return;
  }

  const cues = parseTranscriptText(body) as SubtitleTimelineCue[];

  if (cues.length === 0) {
    return;
  }

  const signature = `${videoId}:${cues.length}:${cues[0]?.startMs ?? 0}:${cues.at(-1)?.endMs ?? 0}`;

  if (signature === lastSentTranscriptTimelineKey) {
    return;
  }

  lastSentTranscriptTimelineKey = signature;
  latestTranscriptTimeline = {
    videoId,
    cues
  };
  websocketClient.send({
    type: "subtitle.timeline",
    timestamp: Date.now(),
    videoId,
    cues
  });
  extensionLogger.debug("Sent transcript timeline to desktop app", {
    videoId,
    cues: cues.length,
    source
  });
};

const subtitleReader = new YouTubeDomSubtitleReader(
  () => {
    const state = getDerivedState();

    if (!state) {
      return null;
    }

    return {
      currentTime: state.currentTime,
      videoId: state.videoId
    };
  },
  () => document.querySelector<HTMLVideoElement>("video"),
  () => latestCaptionTracks,
  requestTranscriptFromPage
);

const websocketClient = new ExtensionWebSocketClient(websocketUrl, {
  onConnected: () => {
    extensionLogger.debug("Sending hello to desktop app", {
      clientId
    });
    websocketClient.send(createHelloMessage(clientId));

    const state = getDerivedState() ?? playerController.getState();
    if (state) {
      latestState = state;
      websocketClient.send(state);
    }

    if (latestSubtitle) {
      websocketClient.send({
        type: "subtitle.update",
        timestamp: Date.now(),
        ...latestSubtitle
      });
    }

    if (latestTranscriptTimeline) {
      websocketClient.send({
        type: "subtitle.timeline",
        timestamp: Date.now(),
        videoId: latestTranscriptTimeline.videoId,
        cues: latestTranscriptTimeline.cues
      });
    }
  },
  onDisconnected: () => {
    extensionLogger.debug("Desktop app is currently disconnected");
  },
  onCommand: (message) => {
    void playerController.applyCommand(message);
  }
});

subtitleReader.start((subtitle) => {
  latestSubtitle = subtitle;

  if (subtitle) {
    if (!hasLoggedSubtitleForVideo || subtitle.videoId !== lastLoggedVideoId) {
      extensionLogger.debug("Subtitle feed detected", {
        videoId: subtitle.videoId,
        preview: subtitle.text.slice(0, 80)
      });
      hasLoggedSubtitleForVideo = true;
    }

    websocketClient.send({
      type: "subtitle.update",
      timestamp: Date.now(),
      ...subtitle
    });
    return;
  }

  const state = latestState ?? playerController.getState();
  const derivedState = getDerivedState() ?? state;
  if (!derivedState) {
    return;
  }

  websocketClient.send({
    type: "subtitle.clear",
    timestamp: Date.now(),
    videoId: derivedState.videoId
  });
});

extensionLogger.debug("Content script booted", {
  href: location.href
});
injectPageBridge();
playerController.start();
websocketClient.connect();

document.addEventListener("visibilitychange", () => {
  extensionLogger.debug("Document visibility changed", {
    hidden: document.hidden,
    videoId: latestState?.videoId ?? null,
    title: latestState?.title ?? null,
    currentTime: getDerivedState()?.currentTime ?? null
  });
});

window.addEventListener("beforeunload", () => {
  for (const pending of pendingTranscriptRequests.values()) {
    window.clearTimeout(pending.timeoutId);
    pending.resolve({
      url: null,
      body: null,
      error: "Content script is unloading"
    });
  }
  pendingTranscriptRequests.clear();
  subtitleReader.stop();
  playerController.stop();
  websocketClient.disconnect();
});
