import { createSeekRelativeCommand, type SubtitleUpdateMessage } from "@youtube-subtitle-companion/shared";

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
  subtitleElement.textContent = currentSubtitle?.text ?? "Waiting for YouTube subtitle feed...";
  subtitleElement.dataset.empty = String(currentSubtitle === null);
  document.body.dataset.hasSubtitle = String(currentSubtitle !== null);
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
