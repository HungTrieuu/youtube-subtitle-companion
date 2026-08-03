import {
  createSeekRelativeCommand,
  type SubtitleTimelineSegment,
  type SubtitleUpdateMessage
} from "@youtube-subtitle-companion/shared";

import type { DictionaryResult, SaveLearningItemRequest } from "../common/learning";
import { formatHotkeyLabel } from "../common/hotkey-label";
import { normalizeLearningWord } from "../common/learning";
import type { OverlayApi } from "../common/ipc";
import type { SpeechLanguage } from "../common/tts";
import type {
  AppConfig,
  OverlayConnectionState,
  OverlayInitialState,
  OverlayUiState
} from "../common/types";
import { canSelectSubtitleWords, isPlayerPausedForOverlay } from "./interaction-state";

declare global {
  interface Window {
    overlayApi: OverlayApi;
  }
}

type LookupStatus = "idle" | "loading" | "success" | "not_found" | "network" | "error";

type PopupState =
  | {
      visible: false;
    }
  | {
      visible: true;
      word: string;
      sentence: string;
      tokenId: string;
      lookupStatus: LookupStatus;
      result: DictionaryResult | null;
      message: string | null;
      speaking: boolean;
      saving: boolean;
    };

const MAX_MEANING_GROUPS = 3;
const MAX_DEFINITIONS_PER_GROUP = 3;
const TOAST_DURATION_MS = 2_600;
const POPUP_MARGIN_PX = 12;
const POPUP_GAP_PX = 10;
const POPUP_PREFERRED_HEIGHT = 320;

const subtitleElement = document.querySelector<HTMLParagraphElement>("#subtitle-text");
const statusElement = document.querySelector<HTMLDivElement>("#status-line");
const debugElement = document.querySelector<HTMLDivElement>("#debug-line");
const dragHandleElement = document.querySelector<HTMLDivElement>("#drag-handle");
const closeOverlayButton = document.querySelector<HTMLButtonElement>("#close-overlay-button");
const wordPopupElement = document.querySelector<HTMLElement>("#word-popup");
const wordPopupWordElement = document.querySelector<HTMLDivElement>("#word-popup-word");
const wordPopupTranslationElement = document.querySelector<HTMLDivElement>("#word-popup-translation");
const wordPopupPhoneticElement = document.querySelector<HTMLDivElement>("#word-popup-phonetic");
const wordPopupBodyElement = document.querySelector<HTMLDivElement>("#word-popup-body");
const wordPopupActionsElement = document.querySelector<HTMLDivElement>("#word-popup-actions");
const toastElement = document.querySelector<HTMLDivElement>("#overlay-toast");

if (
  !subtitleElement ||
  !statusElement ||
  !debugElement ||
  !dragHandleElement ||
  !closeOverlayButton ||
  !wordPopupElement ||
  !wordPopupWordElement ||
  !wordPopupTranslationElement ||
  !wordPopupPhoneticElement ||
  !wordPopupBodyElement ||
  !wordPopupActionsElement ||
  !toastElement
) {
  throw new Error("Overlay renderer root nodes are missing.");
}

let currentConfig: AppConfig | null = null;
let currentSubtitle: SubtitleUpdateMessage | null = null;
let currentConnection: OverlayConnectionState | null = null;
let currentPlayerState: OverlayInitialState["playerState"] = null;
let currentUiState: OverlayUiState | null = null;
let temporaryDimActive = false;
let karaokeFrameId: number | null = null;
let renderedSubtitleKey: string | null = null;
let renderedKaraokeSegments: SubtitleTimelineSegment[] = [];
let renderedKaraokeSpans: HTMLSpanElement[] = [];
let renderedTokenSequence = 0;
let selectedTokenId: string | null = null;
let popupState: PopupState = {
  visible: false
};
let toastTimerId: number | null = null;
let lastPopupReservedTop = 0;
let speechRequestSequence = 0;

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

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const setPopupReservedBottomPadding = (value: number) => {
  document.documentElement.style.setProperty("--popup-reserved-bottom", `${Math.max(0, value)}px`);
};

const getActualPopupReserves = (): { top: number; bottom: number } => {
  if (!currentConfig) {
    return {
      top: 0,
      bottom: 0
    };
  }

  const top = Math.max(0, Math.round(currentConfig.y ?? window.screenY) - Math.round(window.screenY));
  const bottom = Math.max(
    0,
    Math.round(window.innerHeight - currentConfig.height - top)
  );

  return {
    top,
    bottom
  };
};

const syncPopupReservePadding = () => {
  setPopupReservedBottomPadding(getActualPopupReserves().bottom);
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

const detectSpeechLanguage = (text: string): SpeechLanguage | undefined => {
  const trimmed = text.trim();

  if (!trimmed) {
    return undefined;
  }

  if (/[àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]/i.test(trimmed)) {
    return "vi-VN";
  }

  if (/^[\u0000-\u024f\s.,!?;:'"()\-0-9/]+$/.test(trimmed) && /[a-z]/i.test(trimmed)) {
    return "en-US";
  }

  return undefined;
};

const bumpSpeechRequestSequence = (): number => {
  speechRequestSequence += 1;
  return speechRequestSequence;
};

const cancelSpeechRequest = () => {
  bumpSpeechRequestSequence();
};

const getSpeechErrorMessage = (code: string): string => {
  switch (code) {
    case "invalid_text":
      return "Không có câu để phát";
    case "unavailable":
      return "Chưa có extension YouTube đang kết nối";
    case "unsupported":
      return "Extension hiện tại chưa hỗ trợ nghe câu, hãy reload extension";
    default:
      return "Không thể phát giọng đọc";
  }
};

const speakText = async (text: string) => {
  const content = text.trim();

  if (!content) {
    showToast("Không có câu để phát");
    return;
  }

  const requestId = bumpSpeechRequestSequence();
  updatePopupState((state) => ({
    ...state,
    speaking: true
  }));

  const response = await window.overlayApi.speakSubtitle({
    text: content,
    language: detectSpeechLanguage(content)
  });

  if (requestId !== speechRequestSequence) {
    return;
  }

  updatePopupState((state) => ({
    ...state,
    speaking: false
  }));

  if (!response.success) {
    showToast(response.code === "speak_failed" ? response.error : getSpeechErrorMessage(response.code));
  }
};

const isOverlayInteractive = (): boolean =>
  currentUiState !== null && currentUiState.mode !== "click_through";

const isPlayerPaused = (): boolean =>
  isPlayerPausedForOverlay(currentPlayerState, currentConnection);

const canSelectWords = (): boolean =>
  canSelectSubtitleWords(currentUiState, currentPlayerState, currentConnection, currentSubtitle);

const syncInteractionState = () => {
  document.body.dataset.overlayMode = currentUiState?.mode ?? "click_through";
  document.body.dataset.interactive = String(isOverlayInteractive());
  document.body.dataset.wordSelectable = String(canSelectWords());
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

const createTokenId = (): string => {
  renderedTokenSequence += 1;
  return `token-${renderedTokenSequence}`;
};

const appendTokenizedText = (
  container: HTMLElement,
  text: string,
  interactive: boolean
): void => {
  const parts = text.match(/\s+|\S+/g) ?? [];

  for (const part of parts) {
    if (/^\s+$/.test(part)) {
      container.append(document.createTextNode(part));
      continue;
    }

    const word = normalizeLearningWord(part);
    const token = document.createElement("span");
    token.className = "subtitle-token";
    token.textContent = part;
    token.dataset.clickable = String(Boolean(word) && interactive);

    if (word && interactive) {
      const tokenId = createTokenId();
      token.dataset.tokenId = tokenId;
      token.dataset.normalizedWord = word;
      token.dataset.selected = String(selectedTokenId === tokenId);
    }

    container.append(token);
  }
};

const clearSelectedTokenStyle = () => {
  document.querySelectorAll<HTMLElement>(".subtitle-token[data-selected=\"true\"]").forEach((token) => {
    token.dataset.selected = "false";
  });
};

const applySelectedTokenStyle = () => {
  clearSelectedTokenStyle();

  if (!selectedTokenId) {
    return;
  }

  const token = subtitleElement.querySelector<HTMLElement>(
    `.subtitle-token[data-token-id="${CSS.escape(selectedTokenId)}"]`
  );

  if (token) {
    token.dataset.selected = "true";
  }
};

const clearSelection = () => {
  selectedTokenId = null;
  applySelectedTokenStyle();
};

const rebuildSubtitleNodes = () => {
  const nextKey = getSubtitleRenderKey(currentSubtitle);

  if (nextKey === renderedSubtitleKey) {
    applySelectedTokenStyle();
    return;
  }

  renderedSubtitleKey = nextKey;
  renderedKaraokeSegments = [];
  renderedKaraokeSpans = [];
  renderedTokenSequence = 0;
  subtitleElement.replaceChildren();

  if (!currentSubtitle) {
    subtitleElement.textContent = "Waiting for YouTube subtitle feed...";
    return;
  }

  const karaokeSegments = getRenderableKaraokeSegments();

  if (karaokeSegments.length < 2) {
    const fragment = document.createDocumentFragment();
    const wrapper = document.createElement("span");
    appendTokenizedText(wrapper, currentSubtitle.text, true);
    fragment.append(wrapper);
    subtitleElement.append(fragment);
    applySelectedTokenStyle();
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
    span.dataset.karaokeState = "future";
    span.style.setProperty("--segment-fill", "0%");

    const base = document.createElement("span");
    base.className = "subtitle-segment-base";
    appendTokenizedText(base, parts.core, true);

    const fill = document.createElement("span");
    fill.className = "subtitle-segment-fill";
    fill.setAttribute("aria-hidden", "true");
    appendTokenizedText(fill, parts.core, false);

    span.append(base, fill);
    fragment.append(span);
    renderedKaraokeSegments.push(segment);
    renderedKaraokeSpans.push(span);

    if (parts.trailing) {
      fragment.append(document.createTextNode(parts.trailing));
    }
  }

  subtitleElement.append(fragment);
  applySelectedTokenStyle();
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

const getModeLabel = (): string => {
  switch (currentUiState?.mode) {
    case "active":
      return "Active overlay";
    case "move":
      return "Move overlay";
    default:
      return "Click-through";
  }
};

const renderStatus = () => {
  if (!currentConfig || !currentConnection || !currentUiState) {
    statusElement.textContent = "Waiting for overlay state";
    debugElement.textContent = "";
    return;
  }

  const parts = [`${getModeLabel()} mode`];

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
        currentUiState.mode === "active"
          ? "Pause the video to click a word once subtitles appear."
          : "CC may be off, unavailable, or the caption DOM has not updated yet."
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
        currentUiState.mode === "active"
          ? isPlayerPaused()
            ? "Click a word to look it up or save the sentence."
            : "Pause the video to select a word."
          : `Clients: ${currentConnection.clientCount}`
      ]
        .filter(Boolean)
        .join(" | ");
      break;
  }

  statusElement.textContent = parts.join(" | ");
};

const renderSubtitle = () => {
  rebuildSubtitleNodes();
  applySelectedTokenStyle();
  syncKaraokeState();
  subtitleElement.dataset.empty = String(currentSubtitle === null);
  document.body.dataset.hasSubtitle = String(currentSubtitle !== null);
  syncInteractionState();
  scheduleKaraokeLoop();
};

const showBootstrapError = (message: string) => {
  statusElement.textContent = "Overlay bootstrap pending";
  debugElement.textContent = message;
  document.body.dataset.hasSubtitle = "false";
  document.body.dataset.interactive = "false";
  document.body.dataset.wordSelectable = "false";
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
  dragHandleElement.textContent = `Hold ${formatHotkeyLabel(config.hotkeys.moveOverlay)} and drag overlay`;
  syncInteractionState();
  renderStatus();
};

const hideToast = () => {
  toastElement.dataset.visible = "false";

  window.setTimeout(() => {
    if (toastElement.dataset.visible === "false") {
      toastElement.hidden = true;
      toastElement.textContent = "";
    }
  }, 160);
};

const showToast = (message: string) => {
  if (toastTimerId !== null) {
    window.clearTimeout(toastTimerId);
  }

  toastElement.textContent = message;
  toastElement.hidden = false;
  toastElement.dataset.visible = "false";

  window.requestAnimationFrame(() => {
    toastElement.dataset.visible = "true";
  });

  toastTimerId = window.setTimeout(() => {
    toastTimerId = null;
    hideToast();
  }, TOAST_DURATION_MS);
};

const getSelectedTokenElement = (): HTMLElement | null => {
  if (!selectedTokenId) {
    return null;
  }

  return subtitleElement.querySelector<HTMLElement>(
    `.subtitle-token[data-token-id="${CSS.escape(selectedTokenId)}"]`
  );
};

const syncPopupWindowMetrics = () => {
  if (!popupState.visible) {
    if (lastPopupReservedTop !== 0) {
      lastPopupReservedTop = 0;
      window.overlayApi.setPopupMetrics({
        visible: false,
        reservedTop: 0,
        reservedBottom: 0
      });
    }

    return;
  }

  const tokenElement = getSelectedTokenElement();

  if (!tokenElement) {
    return;
  }

  const anchorRect = tokenElement.getBoundingClientRect();
  const popupRect = wordPopupElement.getBoundingClientRect();
  const baseAnchorTop = anchorRect.top - lastPopupReservedTop;
  const neededReservedTop = Math.max(
    0,
    Math.ceil(popupRect.height + POPUP_GAP_PX + POPUP_MARGIN_PX - baseAnchorTop)
  );

  if (neededReservedTop === lastPopupReservedTop) {
    return;
  }

  lastPopupReservedTop = neededReservedTop;
  window.overlayApi.setPopupMetrics({
    visible: true,
    reservedTop: neededReservedTop,
    reservedBottom: 0
  });
};

const closeWordPopup = () => {
  cancelSpeechRequest();
  popupState = {
    visible: false
  };
  wordPopupElement.hidden = true;
  wordPopupBodyElement.replaceChildren();
  wordPopupActionsElement.replaceChildren();
  wordPopupTranslationElement.textContent = "";
  wordPopupPhoneticElement.textContent = "";
  syncPopupWindowMetrics();
  clearSelection();
};

const ensurePopupCanStayOpen = (): boolean => {
  if (!popupState.visible) {
    return false;
  }

  if (!canSelectWords()) {
    closeWordPopup();
    return false;
  }

  if (!getSelectedTokenElement()) {
    closeWordPopup();
    return false;
  }

  return true;
};

const positionWordPopup = () => {
  if (!popupState.visible) {
    return;
  }

  const tokenElement = getSelectedTokenElement();
  if (!tokenElement) {
    closeWordPopup();
    return;
  }

  const anchorRect = tokenElement.getBoundingClientRect();
  const popupRect = wordPopupElement.getBoundingClientRect();
  const popupHeight = Math.min(popupRect.height || POPUP_PREFERRED_HEIGHT, POPUP_PREFERRED_HEIGHT);
  const maxLeft = Math.max(POPUP_MARGIN_PX, window.innerWidth - popupRect.width - POPUP_MARGIN_PX);
  const preferredLeft = anchorRect.left + anchorRect.width / 2 - popupRect.width / 2;
  const popupLeft = clamp(preferredLeft, POPUP_MARGIN_PX, maxLeft);
  const maxTop = Math.max(POPUP_MARGIN_PX, window.innerHeight - popupHeight - POPUP_MARGIN_PX);
  const belowTop = anchorRect.bottom + POPUP_GAP_PX;
  const aboveTop = anchorRect.top - popupHeight - POPUP_GAP_PX;
  const hasBelowSpace =
    window.innerHeight - anchorRect.bottom - POPUP_MARGIN_PX - POPUP_GAP_PX >= popupHeight;
  const hasAboveSpace =
    anchorRect.top - POPUP_MARGIN_PX - POPUP_GAP_PX >= popupHeight;

  let popupTop: number;

  if (hasBelowSpace) {
    popupTop = clamp(belowTop, POPUP_MARGIN_PX, maxTop);
  } else if (hasAboveSpace) {
    popupTop = clamp(aboveTop, POPUP_MARGIN_PX, maxTop);
  } else if (window.innerHeight - anchorRect.bottom >= anchorRect.top) {
    popupTop = clamp(belowTop, POPUP_MARGIN_PX, maxTop);
  } else {
    popupTop = clamp(aboveTop, POPUP_MARGIN_PX, maxTop);
  }

  wordPopupElement.style.left = `${Math.round(popupLeft)}px`;
  wordPopupElement.style.top = `${Math.round(popupTop)}px`;
};

const createPopupButton = (
  label: string,
  onClick: () => void,
  options: {
    primary?: boolean;
    disabled?: boolean;
  } = {}
): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `popup-action${options.primary ? " popup-action--primary" : ""}`;
  button.disabled = Boolean(options.disabled);
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
};

const createPopupStatus = (message: string): HTMLDivElement => {
  const status = document.createElement("div");
  status.className = "popup-status";
  status.textContent = message;
  return status;
};

const renderPopupSentenceSection = (
  state: Extract<PopupState, { visible: true }>
): HTMLElement => {
  const section = document.createElement("section");
  section.className = "popup-sentence";

  const label = document.createElement("div");
  label.className = "popup-section-label";
  label.textContent = "Câu hiện tại";
  section.append(label);

  const sentence = document.createElement("p");
  sentence.className = "popup-sentence-original";
  sentence.textContent = state.sentence;
  section.append(sentence);

  const translation = document.createElement("p");
  translation.className = "popup-sentence-translation";

  if (state.lookupStatus === "loading" || state.lookupStatus === "idle") {
    translation.textContent = "Đang dịch cả câu...";
    translation.dataset.pending = "true";
  } else if (state.lookupStatus === "success" && state.result?.sentenceTranslation) {
    translation.textContent = state.result.sentenceTranslation;
  } else {
    translation.textContent = "Chưa dịch được nghĩa của cả câu.";
    translation.dataset.pending = "false";
  }

  section.append(translation);
  return section;
};

const renderPopupMeaningList = (result: DictionaryResult): DocumentFragment => {
  const fragment = document.createDocumentFragment();
  const meanings = result.meanings.slice(0, MAX_MEANING_GROUPS);

  for (const meaning of meanings) {
    const block = document.createElement("section");
    block.className = "popup-meaning";

    if (meaning.partOfSpeech) {
      const part = document.createElement("div");
      part.className = "popup-part-of-speech";
      part.textContent = meaning.partOfSpeech;
      block.append(part);
    }

    const list = document.createElement("ol");
    list.className = "popup-definition-list";

    for (const definition of meaning.definitions.slice(0, MAX_DEFINITIONS_PER_GROUP)) {
      const item = document.createElement("li");
      item.textContent = definition;
      list.append(item);
    }

    block.append(list);
    fragment.append(block);
  }

  return fragment;
};

const renderPopup = () => {
  if (!popupState.visible) {
    wordPopupElement.hidden = true;
    return;
  }

  if (!ensurePopupCanStayOpen()) {
    return;
  }

  wordPopupElement.hidden = false;
  wordPopupWordElement.textContent = popupState.word;
  wordPopupTranslationElement.textContent =
    popupState.lookupStatus === "success" ? popupState.result?.shortTranslation ?? "" : "";
  wordPopupPhoneticElement.textContent =
    popupState.lookupStatus === "success" ? popupState.result?.phonetic ?? "" : "";
  wordPopupBodyElement.replaceChildren();
  wordPopupActionsElement.replaceChildren();

  wordPopupBodyElement.append(renderPopupSentenceSection(popupState));

  if (popupState.lookupStatus === "loading" || popupState.lookupStatus === "idle") {
    wordPopupBodyElement.append(createPopupStatus("Đang tra nghĩa từ..."));
  } else if (popupState.lookupStatus === "success" && popupState.result) {
    wordPopupBodyElement.append(renderPopupMeaningList(popupState.result));
  } else if (popupState.lookupStatus !== "idle" && popupState.message) {
    wordPopupBodyElement.append(createPopupStatus(popupState.message));
  }

  if (
    popupState.lookupStatus === "idle" ||
    popupState.lookupStatus === "loading" ||
    popupState.lookupStatus === "success"
  ) {
    const speakDisabled = popupState.speaking;
    const speakLabel = popupState.speaking ? "Đang phát..." : "Nghe câu";
    const saveDisabled = popupState.saving || popupState.lookupStatus === "loading";
    const saveLabel =
      popupState.lookupStatus === "loading"
        ? "Đang tra..."
        : popupState.saving
          ? "Đang lưu..."
          : "Lưu câu";

    wordPopupActionsElement.append(
      createPopupButton(speakLabel, () => {
        void speakText(popupState.sentence);
      }, { disabled: speakDisabled }),
      createPopupButton(saveLabel, () => {
        void saveSelectedWord();
      }, { primary: true, disabled: saveDisabled }),
      createPopupButton("Đóng", () => {
        closeWordPopup();
      })
    );
  } else {
    const speakLabel = popupState.speaking ? "Đang phát..." : "Nghe câu";
    wordPopupActionsElement.append(
      createPopupButton("Thử lại", () => {
        void lookupSelectedWord();
      }, { primary: true }),
      createPopupButton(speakLabel, () => {
        void speakText(popupState.sentence);
      }, { disabled: popupState.speaking }),
      createPopupButton(popupState.saving ? "Đang lưu..." : "Lưu câu", () => {
        void saveSelectedWord();
      }, { disabled: popupState.saving }),
      createPopupButton("Đóng", () => {
        closeWordPopup();
      })
    );
  }

  window.requestAnimationFrame(() => {
    positionWordPopup();
    syncPopupWindowMetrics();
  });
};

const openWordPopup = (token: HTMLElement) => {
  if (!canSelectWords()) {
    return;
  }

  const sentence = currentSubtitle?.text.trim();
  const tokenId = token.dataset.tokenId;
  const word = token.dataset.normalizedWord;

  if (!tokenId || !word || !sentence) {
    return;
  }

  selectedTokenId = tokenId;
  popupState = {
    visible: true,
    word,
    sentence,
    tokenId,
    lookupStatus: "loading",
    result: null,
    message: null,
    speaking: false,
    saving: false
  };

  applySelectedTokenStyle();
  renderPopup();
  void runDictionaryLookup(word, tokenId);
};

const updatePopupState = (
  updater: (state: Extract<PopupState, { visible: true }>) => Extract<PopupState, { visible: true }>
): void => {
  if (!popupState.visible) {
    return;
  }

  popupState = updater(popupState);
  renderPopup();
};

const runDictionaryLookup = async (lookupWord: string, tokenId: string) => {
  const sentence =
    popupState.visible && popupState.tokenId === tokenId && popupState.word === lookupWord
      ? popupState.sentence
      : undefined;
  const response = await window.overlayApi.lookupDictionary({
    word: lookupWord,
    sentence
  });

  if (!popupState.visible || popupState.tokenId !== tokenId || popupState.word !== lookupWord) {
    return;
  }

  if (response.success) {
    updatePopupState((state) => ({
      ...state,
      lookupStatus: "success",
      result: response.result,
      message: null
    }));
    return;
  }

  const status: LookupStatus =
    response.code === "not_found"
      ? "not_found"
      : response.code === "timeout" || response.code === "network"
        ? "network"
        : "error";
  const message =
    response.code === "not_found"
      ? "Không tìm thấy nghĩa cho từ này."
      : response.code === "timeout" || response.code === "network"
        ? "Không thể kết nối tới từ điển."
        : "Tra từ thất bại.";

  updatePopupState((state) => ({
    ...state,
    lookupStatus: status,
    result: null,
    message: message || response.error
  }));
};

const lookupSelectedWord = async () => {
  if (!popupState.visible || popupState.lookupStatus === "loading") {
    return;
  }

  const lookupWord = popupState.word;
  const tokenId = popupState.tokenId;

  updatePopupState((state) => ({
    ...state,
    lookupStatus: "loading",
    result: null,
    message: null
  }));
  await runDictionaryLookup(lookupWord, tokenId);
};

const saveSelectedWord = async () => {
  if (!popupState.visible || popupState.saving) {
    return;
  }

  const request: SaveLearningItemRequest = {
    word: popupState.word,
    wordTranslation: popupState.result?.shortTranslation,
    sentence: popupState.sentence,
    sentenceTranslation: popupState.result?.sentenceTranslation,
    videoId:
      currentPlayerState?.videoId ?? currentConnection?.sourceVideoId ?? currentSubtitle?.videoId ?? null,
    videoTitle: currentPlayerState?.title ?? currentConnection?.sourceTitle ?? null,
    timestampMs: Math.round(derivePlayerCurrentTime() * 1000)
  };
  const tokenId = popupState.tokenId;
  const savedWord = popupState.word;

  updatePopupState((state) => ({
    ...state,
    saving: true
  }));

  const response = await window.overlayApi.saveLearningItem(request);

  if (popupState.visible && popupState.tokenId === tokenId) {
    updatePopupState((state) => ({
      ...state,
      saving: false
    }));
  }

  if (!response.success) {
    showToast("Không thể lưu câu");
    return;
  }

  if (response.duplicate) {
    showToast("Từ này đã được lưu");
    return;
  }

  showToast(`Đã lưu “${savedWord}”`);
};

const bootstrap = async () => {
  const initialState: OverlayInitialState = await loadInitialState();
  currentSubtitle = initialState.subtitle;
  currentConnection = initialState.connection;
  currentPlayerState = initialState.playerState;
  currentUiState = initialState.uiState;
  applyConfig(initialState.config);
  syncPopupReservePadding();
  renderSubtitle();
  renderStatus();
  renderPopup();
  syncDimState();

  window.overlayApi.onSubtitle((subtitle) => {
    const previousKey = getSubtitleRenderKey(currentSubtitle);
    const nextKey = getSubtitleRenderKey(subtitle);
    currentSubtitle = subtitle;

    if (popupState.visible && previousKey !== nextKey) {
      closeWordPopup();
    }

    renderSubtitle();
    renderStatus();
  });

  window.overlayApi.onConfig((config) => {
    applyConfig(config);
    syncPopupReservePadding();
  });

  window.overlayApi.onConnection((connection) => {
    currentConnection = connection;
    syncInteractionState();
    renderStatus();
  });

  window.overlayApi.onUiState((uiState) => {
    const previousMode = currentUiState?.mode;
    currentUiState = uiState;

    if (popupState.visible && previousMode === "active" && uiState.mode !== "active") {
      closeWordPopup();
    }

    syncInteractionState();
    syncPopupReservePadding();
    renderStatus();
    renderPopup();
  });

  window.overlayApi.onPlayerState((playerState) => {
    currentPlayerState = playerState;

    if (popupState.visible && !canSelectWords()) {
      closeWordPopup();
    }

    syncInteractionState();
    syncKaraokeState();
    scheduleKaraokeLoop();
    renderStatus();
  });

  window.overlayApi.onTemporaryDim((active) => {
    temporaryDimActive = active;
    syncDimState();
  });
};

subtitleElement.addEventListener("click", (event) => {
  const target = event.target;

  if (!(target instanceof Element)) {
    return;
  }

  const token = target.closest(".subtitle-token[data-clickable=\"true\"]");

  if (!(token instanceof HTMLElement) || !canSelectWords()) {
    return;
  }

  event.stopPropagation();
  openWordPopup(token);
});

subtitleElement.addEventListener("pointerdown", (event) => {
  const target = event.target;

  if (!(target instanceof Element)) {
    return;
  }

  if (
    target.closest(".subtitle-token[data-clickable=\"true\"]") instanceof HTMLElement &&
    canSelectWords()
  ) {
    event.stopPropagation();
  }
});

subtitleElement.addEventListener("dblclick", (event) => {
  if (canSelectWords()) {
    event.preventDefault();
    return;
  }

  window.overlayApi.sendPlayerCommand(createSeekRelativeCommand(-10));
});

document.addEventListener("click", (event) => {
  if (!popupState.visible) {
    return;
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  if (target.closest("#word-popup") || target.closest(".subtitle-token[data-clickable=\"true\"]")) {
    return;
  }

  closeWordPopup();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !popupState.visible) {
    return;
  }

  event.preventDefault();
  closeWordPopup();
});

document.addEventListener("contextmenu", (event) => {
  if (!isOverlayInteractive()) {
    return;
  }

  event.preventDefault();
  void window.overlayApi.openContextMenu({
    x: event.x,
    y: event.y
  });
});

window.addEventListener("resize", () => {
  syncPopupReservePadding();

  if (popupState.visible) {
    positionWordPopup();
    syncPopupWindowMetrics();
  }
});

closeOverlayButton.addEventListener("click", () => {
  cancelSpeechRequest();
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
