import { clampTime, type PlayerStateMessage, type SubtitleTimelineCue, type SubtitleUpdateMessage } from "@youtube-subtitle-companion/shared";

export const derivePlayerCurrentTime = (playerState: PlayerStateMessage): number => {
  if (!playerState.playing) {
    return clampTime(playerState.currentTime, playerState.duration);
  }

  const elapsedSeconds = Math.max(0, (Date.now() - playerState.timestamp) / 1000);
  return clampTime(
    playerState.currentTime + elapsedSeconds * playerState.playbackRate,
    playerState.duration
  );
};

export const getTimelineSubtitle = (input: {
  playerState: PlayerStateMessage | null;
  subtitleTimeline: SubtitleTimelineCue[] | null;
  subtitleTimelineVideoId: string | null;
  subtitleTimelineIndex: number;
}): {
  subtitle: SubtitleUpdateMessage | null;
  nextIndex: number;
} => {
  if (
    !input.playerState ||
    !input.subtitleTimeline ||
    input.subtitleTimeline.length === 0 ||
    input.subtitleTimelineVideoId !== input.playerState.videoId
  ) {
    return {
      subtitle: null,
      nextIndex: input.subtitleTimelineIndex
    };
  }

  const currentTimeMs = derivePlayerCurrentTime(input.playerState) * 1000;
  let index = Math.min(input.subtitleTimelineIndex, Math.max(input.subtitleTimeline.length - 1, 0));

  while (index > 0 && input.subtitleTimeline[index]!.startMs > currentTimeMs) {
    index -= 1;
  }

  while (
    index < input.subtitleTimeline.length &&
    input.subtitleTimeline[index]!.endMs <= currentTimeMs
  ) {
    index += 1;
  }

  const cue = input.subtitleTimeline[index];

  if (!cue || cue.startMs > currentTimeMs || currentTimeMs >= cue.endMs) {
    return {
      subtitle: null,
      nextIndex: index
    };
  }

  return {
    nextIndex: index,
    subtitle: {
      type: "subtitle.update",
      timestamp: Date.now(),
      videoId: input.playerState.videoId,
      text: cue.text,
      currentTime: currentTimeMs / 1000,
      cueStartMs: cue.startMs,
      cueEndMs: cue.endMs,
      ...(cue.segments ? { segments: cue.segments } : {})
    }
  };
};
