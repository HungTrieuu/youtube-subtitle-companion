import { mergeCaptionSegments, normalizeSubtitleText } from "./dom-caption-source";

const readCueText = (cue: TextTrackCue): string | null => {
  if ("text" in cue && typeof cue.text === "string") {
    const normalized = normalizeSubtitleText(cue.text);
    return normalized.length > 0 ? normalized : null;
  }

  return null;
};

export const readTextTrackSubtitle = (video: HTMLVideoElement | null): string | null => {
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
