import type { DeleteLearningItemRequest, LearningItem } from "../common/learning";
import type { OverlayApi } from "../common/ipc";

declare global {
  interface Window {
    overlayApi: OverlayApi;
  }
}

const summaryElement = document.querySelector<HTMLParagraphElement>("#page-summary");
const refreshButton = document.querySelector<HTMLButtonElement>("#refresh-button");
const errorBanner = document.querySelector<HTMLDivElement>("#error-banner");
const emptyState = document.querySelector<HTMLElement>("#empty-state");
const groupsElement = document.querySelector<HTMLElement>("#groups");

if (!summaryElement || !refreshButton || !errorBanner || !emptyState || !groupsElement) {
  throw new Error("Saved words renderer root nodes are missing.");
}

let currentItems: LearningItem[] = [];
let deletingItemKey: string | null = null;

const dayFormatter = new Intl.DateTimeFormat("vi-VN", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

const timeFormatter = new Intl.DateTimeFormat("vi-VN", {
  hour: "2-digit",
  minute: "2-digit"
});

const formatCueTime = (timestampMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(timestampMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const formatSavedAt = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : timeFormatter.format(date);
};

const formatGroupLabel = (dateKey: string): string => {
  const date = new Date(`${dateKey}T00:00:00`);
  return Number.isNaN(date.getTime()) ? dateKey : dayFormatter.format(date);
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");

const getLearningItemKey = (item: DeleteLearningItemRequest): string =>
  JSON.stringify([
    item.word,
    item.sentence,
    item.videoId,
    item.videoTitle,
    item.timestampMs,
    item.savedAt,
    item.status
  ]);

const renderLoadingState = () => {
  groupsElement.innerHTML = '<div class="loading-state">Loading saved words...</div>';
  emptyState.hidden = true;
  errorBanner.hidden = true;
};

const renderError = (message: string, preserveContent = false) => {
  errorBanner.textContent = message;
  errorBanner.hidden = false;
  if (!preserveContent) {
    groupsElement.innerHTML = "";
    emptyState.hidden = true;
  }
  summaryElement.textContent = "Could not load saved words.";
};

const renderItems = (items: LearningItem[]) => {
  currentItems = items;
  const grouped = new Map<string, LearningItem[]>();

  for (const item of items) {
    const key = item.savedAt.slice(0, 10);
    const existing = grouped.get(key);

    if (existing) {
      existing.push(item);
    } else {
      grouped.set(key, [item]);
    }
  }

  summaryElement.textContent =
    items.length === 0
      ? "No saved words yet."
      : `${items.length} saved word${items.length === 1 ? "" : "s"} across ${grouped.size} day${grouped.size === 1 ? "" : "s"}.`;

  if (items.length === 0) {
    groupsElement.innerHTML = "";
    emptyState.hidden = false;
    errorBanner.hidden = true;
    return;
  }

  emptyState.hidden = true;
  errorBanner.hidden = true;
  groupsElement.innerHTML = Array.from(grouped.entries())
    .map(([dateKey, dayItems]) => {
      const itemsMarkup = dayItems
        .map((item) => {
          const itemKey = getLearningItemKey(item);
          const deleteLabel = deletingItemKey === itemKey ? "Deleting..." : "Delete";
          const videoMetaParts = [
            item.videoTitle ? `<strong>${escapeHtml(item.videoTitle)}</strong>` : null,
            item.videoId ? escapeHtml(item.videoId) : null,
            escapeHtml(formatCueTime(item.timestampMs))
          ].filter((value): value is string => value !== null);
          const videoMeta =
            videoMetaParts.length > 0
              ? `<div class="learning-video">${videoMetaParts.join(" · ")}</div>`
              : "";
          const wordTranslation = item.wordTranslation
            ? `<div class="learning-word-translation">${escapeHtml(item.wordTranslation)}</div>`
            : "";
          const sentenceTranslation = item.sentenceTranslation
            ? `<p class="learning-sentence-translation">${escapeHtml(item.sentenceTranslation)}</p>`
            : "";

          return `
            <article class="learning-item">
              <div class="learning-item-topline">
                <div class="learning-item-heading">
                  <div class="learning-word-block">
                    <span class="learning-word">${escapeHtml(item.word)}</span>
                    ${wordTranslation}
                  </div>
                  <span class="learning-meta">${escapeHtml(formatSavedAt(item.savedAt))}</span>
                </div>
                <button
                  class="learning-delete-button"
                  type="button"
                  data-action="delete-learning-item"
                  data-item-key="${escapeHtml(itemKey)}"
                  ${deletingItemKey === itemKey ? "disabled" : ""}
                >
                  ${deleteLabel}
                </button>
              </div>
              <p class="learning-sentence">${escapeHtml(item.sentence)}</p>
              ${sentenceTranslation}
              ${videoMeta}
            </article>
          `;
        })
        .join("");

      return `
        <section class="day-group">
          <header class="day-group-header">
            <h2 class="day-group-title">${escapeHtml(formatGroupLabel(dateKey))}</h2>
            <div class="day-group-count">${dayItems.length} item${dayItems.length === 1 ? "" : "s"}</div>
          </header>
          <div class="learning-list">${itemsMarkup}</div>
        </section>
      `;
    })
    .join("");
};

const loadItems = async (showLoading = false) => {
  if (showLoading) {
    renderLoadingState();
  }

  refreshButton.disabled = true;
  errorBanner.hidden = true;

  try {
    const response = await window.overlayApi.getLearningItems();

    if (!response.success) {
      renderError(response.error);
      return;
    }

    renderItems(response.items);
  } catch (error) {
    renderError(error instanceof Error ? error.message : "Could not load saved words.");
  } finally {
    refreshButton.disabled = false;
    deletingItemKey = null;
  }
};

refreshButton.addEventListener("click", () => {
  void loadItems(true);
});

groupsElement.addEventListener("click", (event) => {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>('[data-action="delete-learning-item"]');

  if (!button) {
    return;
  }

  const itemKey = button.dataset.itemKey;

  if (!itemKey) {
    return;
  }

  const item = currentItems.find((candidate) => getLearningItemKey(candidate) === itemKey);

  if (!item) {
    void loadItems(false);
    return;
  }

  const confirmed = window.confirm(`Delete saved word "${item.word}"?`);

  if (!confirmed) {
    return;
  }

  deletingItemKey = itemKey;
  renderItems(currentItems);

  void window.overlayApi.deleteLearningItem(item).then((response) => {
    if (!response.success) {
      deletingItemKey = null;
      renderItems(currentItems);
      renderError(response.error, true);
      return;
    }

    if (!response.deleted) {
      deletingItemKey = null;
      renderItems(currentItems);
      renderError("This saved word no longer exists.", true);
      void loadItems(false);
      return;
    }

    void loadItems(false);
  });
});

window.overlayApi.onLearningItemsUpdated(() => {
  void loadItems(false);
});

void loadItems(true);
