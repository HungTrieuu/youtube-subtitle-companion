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

export const readDomSubtitle = (): string | null => {
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
