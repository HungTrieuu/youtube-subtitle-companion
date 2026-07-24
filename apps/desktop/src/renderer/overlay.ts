import {
  createSeekRelativeCommand,
  type SubtitleTimelineSegment,
  type SubtitleUpdateMessage
} from "@youtube-subtitle-companion/shared";

import type { OverlayApi } from "../common/ipc";
import type { AppConfig, OverlayConnectionState, OverlayInitialState } from "../common/types";

declare global {
  interface Window {
    overlayApi: OverlayApi;
  }
}

const subtitleElement = document.querySelector<HTMLParagraphElement>("#subtitle-text");
const statusElement = document.querySelector<HTMLDivElement>("#status-line");
const debugElement = document.querySelector<HTMLDivElement>("#debug-line");
const closeOverlayButton = document.querySelector<HTMLButtonElement>("#close-overlay-button");

if (!subtitleElement || !statusElement || !debugElement || !closeOverlayButton) {
  throw new Error("Overlay renderer root nodes are missing.");
}

let currentConfig: AppConfig | null = null;
let currentSubtitle: SubtitleUpdateMessage | null = null;
let currentConnection: OverlayConnectionState | null = null;
let currentPlayerState: OverlayInitialState["playerState"] = null;
let temporaryDimActive = false;
let karaokeFrameId: number | null = null;
let renderedSubtitleKey: string | null = null;
let renderedKaraokeSegments: SubtitleTimelineSegment[] = [];
let renderedKaraokeSpans: HTMLSpanElement[] = [];

const formatTime = (totalSeconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const formatAge = (timestamp: number | null): string => {
  if (timestamp === null) {
    return "never";
  }

  const ageSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  return `${ageSeconds}s ago`;
};

const shorten = (value: string | null, maxLength: number): string | null => {
  if (!value) {
    return null;
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
};

const syncDimState = () => {
  document.body.dataset.subtitleHovered = String(temporaryDimActive);
};

const derivePlayerCurrentTime = (now = Date.now()): number => {
  if (currentPlayerState) {
    if (!currentPlayerState.playing) {
      return currentPlayerState.currentTime;
    }

    const elapsedSeconds = Math.max(0, (now - currentPlayerState.timestamp) / 1000);
    return Math.min(
      currentPlayerState.duration,
      currentPlayerState.currentTime + elapsedSeconds * currentPlayerState.playbackRate
    );
  }

  return currentSubtitle?.currentTime ?? 0;
};

const buildPseudoKaraokeSegments = (
  subtitle: SubtitleUpdateMessage
): SubtitleTimelineSegment[] => {
  if (
    typeof subtitle.cueStartMs !== "number" ||
    typeof subtitle.cueEndMs !== "number" ||
    subtitle.cueEndMs <= subtitle.cueStartMs
  ) {
    return [];
  }

  const tokens = subtitle.text.match(/\S+\s*/g) ?? [];

  if (tokens.length < 2) {
    return [];
  }

  const totalDurationMs = subtitle.cueEndMs - subtitle.cueStartMs;
  const totalWeight = tokens.reduce(
    (sum, token) => sum + Math.max(1, token.trim().length),
    0
  );
  const segments: SubtitleTimelineSegment[] = [];
  let cursorMs = subtitle.cueStartMs;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const weight = Math.max(1, token.trim().length);
    const isLast = index === tokens.length - 1;
    const durationMs = isLast
      ? subtitle.cueEndMs - cursorMs
      : Math.max(80, Math.round((totalDurationMs * weight) / totalWeight));
    const endMs = isLast
      ? subtitle.cueEndMs
      : Math.min(subtitle.cueEndMs, cursorMs + durationMs);

    segments.push({
      startMs: cursorMs,
      endMs,
      text: token
    });

    cursorMs = endMs;
  }

  for (let index = 0; index < segments.length - 1; index += 1) {
    segments[index]!.endMs = Math.max(segments[index]!.endMs, segments[index + 1]!.startMs);
  }

  return segments.filter((segment) => segment.endMs > segment.startMs);
};

const getRenderableKaraokeSegments = (): SubtitleTimelineSegment[] => {
  if (!currentSubtitle) {
    return [];
  }

  if (currentSubtitle.segments && currentSubtitle.segments.length >= 2) {
    return currentSubtitle.segments;
  }

  return buildPseudoKaraokeSegments(currentSubtitle);
};

const getSubtitleRenderKey = (subtitle: SubtitleUpdateMessage | null): string => {
  if (!subtitle) {
    return "empty";
  }

  const segmentKey =
    subtitle.segments?.map((segment) => `${segment.startMs}-${segment.endMs}:${segment.text}`).join("|") ??
    "plain";

  return [
    subtitle.videoId,
    subtitle.cueStartMs ?? "na",
    subtitle.cueEndMs ?? "na",
    subtitle.text,
    segmentKey
  ].join("::");
};

const splitSegmentText = (value: string): { leading: string; core: string; trailing: string } => {
  const match = /^(\s*)(.*?)(\s*)$/.exec(value);

  if (!match) {
    return {
      leading: "",
      core: value,
      trailing: ""
    };
  }

  return {
    leading: match[1] ?? "",
    core: match[2] ?? value,
    trailing: match[3] ?? ""
  };
};

const rebuildSubtitleNodes = () => {
  const nextKey = getSubtitleRenderKey(currentSubtitle);

  if (nextKey === renderedSubtitleKey) {
    return;
  }

  renderedSubtitleKey = nextKey;
  renderedKaraokeSegments = [];
  renderedKaraokeSpans = [];
  subtitleElement.replaceChildren();

  if (!currentSubtitle) {
    subtitleElement.textContent = "Waiting for YouTube subtitle feed...";
    return;
  }

  const karaokeSegments = getRenderableKaraokeSegments();

  if (karaokeSegments.length < 2) {
    subtitleElement.textContent = currentSubtitle.text;
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const segment of karaokeSegments) {
    const parts = splitSegmentText(segment.text);

    if (parts.leading) {
      fragment.append(document.createTextNode(parts.leading));
    }

    const span = document.createElement("span");
    span.className = "subtitle-segment";
    span.textContent = parts.core;
    span.dataset.karaokeState = "future";
    span.style.setProperty("--segment-fill", "0%");
    fragment.append(span);
    renderedKaraokeSegments.push(segment);
    renderedKaraokeSpans.push(span);

    if (parts.trailing) {
      fragment.append(document.createTextNode(parts.trailing));
    }
  }

  subtitleElement.append(fragment);
};

const syncKaraokeState = (): boolean => {
  if (!currentSubtitle) {
    return false;
  }

  if (renderedKaraokeSegments.length < 2 || renderedKaraokeSpans.length !== renderedKaraokeSegments.length) {
    return false;
  }

  const currentMs = derivePlayerCurrentTime() * 1000;
  let shouldContinue = false;

  for (let index = 0; index < renderedKaraokeSegments.length; index += 1) {
    const segment = renderedKaraokeSegments[index]!;
    const span = renderedKaraokeSpans[index]!;
    const durationMs = Math.max(1, segment.endMs - segment.startMs);
    const rawProgress = (currentMs - segment.startMs) / durationMs;
    const progress = Math.max(0, Math.min(1, rawProgress));
    const karaokeState =
      progress >= 1 ? "past" : progress <= 0 ? "future" : "current";
    const fillPercent = `${Math.round(progress * 1000) / 10}%`;

    if (span.dataset.karaokeState !== karaokeState) {
      span.dataset.karaokeState = karaokeState;
    }

    if (span.style.getPropertyValue("--segment-fill") !== fillPercent) {
      span.style.setProperty("--segment-fill", fillPercent);
    }

    if (progress > 0 && progress < 1) {
      shouldContinue = true;
    }
  }

  return shouldContinue || Boolean(currentPlayerState?.playing);
};

const stopKaraokeLoop = () => {
  if (karaokeFrameId !== null) {
    window.cancelAnimationFrame(karaokeFrameId);
    karaokeFrameId = null;
  }
};

const scheduleKaraokeLoop = () => {
  stopKaraokeLoop();

  if (renderedKaraokeSegments.length < 2) {
    return;
  }

  const tick = () => {
    karaokeFrameId = null;
    const shouldContinue = syncKaraokeState();

    if (shouldContinue) {
      karaokeFrameId = window.requestAnimationFrame(tick);
    }
  };

  karaokeFrameId = window.requestAnimationFrame(tick);
};

const renderStatus = () => {
  if (!currentConfig || !currentConnection) {
    statusElement.textContent = "Waiting for overlay state";
    debugElement.textContent = "";
    return;
  }

  const modeLabel = currentConfig.clickThrough ? "Click-through" : "Interactive";
  const parts = [`${modeLabel} mode`];

  switch (currentConnection.status) {
    case "waiting_for_extension":
      parts.push("no extension connected");
      debugElement.textContent =
        "Open the desktop app first, then refresh a YouTube watch tab with CC enabled.";
      break;

    case "waiting_for_player":
      parts.push("extension connected, waiting for player");
      debugElement.textContent = [
        `Clients: ${currentConnection.clientCount}`,
        currentConnection.clientId ? `Client: ${shorten(currentConnection.clientId, 10)}` : null,
        currentConnection.extensionVersion
          ? `Extension: ${currentConnection.extensionVersion}`
          : null,
        "Expect a youtube.com/watch page with a live <video> element."
      ]
        .filter(Boolean)
        .join(" | ");
      break;

    case "waiting_for_subtitle":
      parts.push("player detected, waiting for captions");
      debugElement.textContent = [
        currentConnection.sourceTitle ? `Source: ${shorten(currentConnection.sourceTitle, 48)}` : null,
        currentConnection.sourceVideoId ? `Video: ${currentConnection.sourceVideoId}` : null,
        currentPlayerState
          ? `Player: ${currentPlayerState.playing ? "playing" : "paused"} ${formatTime(currentPlayerState.currentTime)} / ${formatTime(currentPlayerState.duration)}`
          : null,
        `Last player update: ${formatAge(currentConnection.lastPlayerStateAt)}`,
        "CC may be off, unavailable, or the caption DOM has not updated yet."
      ]
        .filter(Boolean)
        .join(" | ");
      break;

    case "receiving_subtitles":
      parts.push("subtitles live");
      debugElement.textContent = [
        currentConnection.sourceTitle ? `Source: ${shorten(currentConnection.sourceTitle, 48)}` : null,
        currentPlayerState
          ? `Player: ${currentPlayerState.playing ? "playing" : "paused"} ${formatTime(currentPlayerState.currentTime)} / ${formatTime(currentPlayerState.duration)} @${currentPlayerState.playbackRate.toFixed(2)}x`
          : null,
        `Last subtitle: ${formatAge(currentConnection.lastSubtitleAt)}`,
        `Clients: ${currentConnection.clientCount}`
      ]
        .filter(Boolean)
        .join(" | ");
      break;
  }

  statusElement.textContent = parts.join(" | ");
};

const renderSubtitle = () => {
  rebuildSubtitleNodes();
  syncKaraokeState();
  subtitleElement.dataset.empty = String(currentSubtitle === null);
  document.body.dataset.hasSubtitle = String(currentSubtitle !== null);
  scheduleKaraokeLoop();
};

const showBootstrapError = (message: string) => {
  statusElement.textContent = "Overlay bootstrap pending";
  debugElement.textContent = message;
  document.body.dataset.hasSubtitle = "false";
};

const loadInitialState = async (): Promise<OverlayInitialState> => {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await window.overlayApi.getInitialState();
    } catch (error) {
      lastError = error;
      showBootstrapError(`Waiting for desktop IPC (${attempt + 1}/20)...`);
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 150);
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const applyConfig = (config: AppConfig) => {
  currentConfig = config;
  const hoverOpacity = Math.max(0.12, Math.min(config.opacity * 0.35, config.opacity));
  document.documentElement.style.setProperty("--font-size", `${config.fontSize}px`);
  document.documentElement.style.setProperty("--subtitle-opacity", `${config.opacity}`);
  document.documentElement.style.setProperty("--subtitle-hover-opacity", `${hoverOpacity}`);
  document.documentElement.style.setProperty("--subtitle-align", config.alignment);
  document.body.dataset.interactive = String(!config.clickThrough);
  renderStatus();
};

const bootstrap = async () => {
  const initialState: OverlayInitialState = await loadInitialState();
  currentSubtitle = initialState.subtitle;
  currentConnection = initialState.connection;
  currentPlayerState = initialState.playerState;
  applyConfig(initialState.config);
  renderSubtitle();
  renderStatus();
  syncDimState();

  window.overlayApi.onSubtitle((subtitle) => {
    currentSubtitle = subtitle;
    renderSubtitle();
    renderStatus();
  });

  window.overlayApi.onConfig((config) => {
    applyConfig(config);
  });

  window.overlayApi.onConnection((connection) => {
    currentConnection = connection;
    renderStatus();
  });

  window.overlayApi.onPlayerState((playerState) => {
    currentPlayerState = playerState;
    renderStatus();
  });

  window.overlayApi.onTemporaryDim((active) => {
    temporaryDimActive = active;
    syncDimState();
  });
};

subtitleElement.addEventListener("dblclick", () => {
  window.overlayApi.sendPlayerCommand(createSeekRelativeCommand(-10));
});

document.addEventListener("contextmenu", (event) => {
  if (currentConfig?.clickThrough) {
    return;
  }

  event.preventDefault();
  void window.overlayApi.openContextMenu({
    x: event.x,
    y: event.y
  });
});

closeOverlayButton.addEventListener("click", () => {
  window.overlayApi.toggleOverlay();
});

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  showBootstrapError(`Overlay failed to start: ${message}`);
  console.error("[yt-sub-companion:overlay] bootstrap failed", error);
});

window.setInterval(() => {
  renderStatus();
}, 1000);
