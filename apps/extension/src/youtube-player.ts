import {
  clampRelativeSeek,
  clampTime,
  type PlayerCommandMessage,
  type PlayerStateMessage
} from "@youtube-subtitle-companion/shared";

const VIDEO_EVENTS = [
  "play",
  "pause",
  "ratechange",
  "loadedmetadata",
  "durationchange",
  "timeupdate",
  "seeking",
  "ended",
  "emptied"
] as const;

const emitIntervalMs = 500;
const stateHeartbeatIntervalMs = 1000;

const getVideoId = (): string | null => {
  if (location.pathname !== "/watch") {
    return null;
  }

  return new URL(location.href).searchParams.get("v");
};

const sanitizeTitle = (value: string | null | undefined): string => (value ?? "").trim();

const stripYouTubeSuffix = (value: string): string => value.replace(/\s+-\s+YouTube$/, "").trim();

export const resolvePlayerTitle = (input: {
  headingTitle?: string | null;
  documentTitle?: string | null;
  previousTitle?: string | null;
}): string => {
  const headingTitle = sanitizeTitle(input.headingTitle);
  if (headingTitle.length > 0) {
    return headingTitle;
  }

  const documentTitle = stripYouTubeSuffix(sanitizeTitle(input.documentTitle));
  if (documentTitle.length > 0) {
    return documentTitle;
  }

  const previousTitle = sanitizeTitle(input.previousTitle);
  if (previousTitle.length > 0) {
    return previousTitle;
  }

  return "YouTube";
};

export class YouTubePlayerController {
  private readonly observer = new MutationObserver(() => {
    this.refreshVideo();
  });
  private readonly navigationListener = () => {
    this.refreshVideo(true);
  };
  private readonly visibilityListener = () => {
    this.emitState();
  };
  private readonly heartbeatListener = () => {
    this.emitState();
  };
  private readonly videoListener = (event: Event) => {
    if (event.type === "timeupdate") {
      const now = Date.now();

      if (now - this.lastEmissionAt < emitIntervalMs) {
        return;
      }

      this.lastEmissionAt = now;
    }

    this.emitState();
  };
  private video: HTMLVideoElement | null = null;
  private lastEmissionAt = 0;
  private heartbeatTimer: number | null = null;
  private lastKnownVideoId: string | null = null;
  private lastKnownTitle: string | null = null;

  public constructor(private readonly onState: (state: PlayerStateMessage) => void) {}

  public start(): void {
    this.refreshVideo(true);
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    window.addEventListener("yt-navigate-finish", this.navigationListener);
    window.addEventListener("popstate", this.navigationListener);
    document.addEventListener("visibilitychange", this.visibilityListener);
    this.heartbeatTimer = window.setInterval(this.heartbeatListener, stateHeartbeatIntervalMs);
  }

  public stop(): void {
    this.detachVideo();
    this.observer.disconnect();
    window.removeEventListener("yt-navigate-finish", this.navigationListener);
    window.removeEventListener("popstate", this.navigationListener);
    document.removeEventListener("visibilitychange", this.visibilityListener);

    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public getState(): PlayerStateMessage | null {
    const video = this.ensureVideo();
    const videoId = getVideoId();

    if (!video || !videoId) {
      return null;
    }

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const heading = document.querySelector<HTMLElement>(
      "ytd-watch-metadata h1 yt-formatted-string, h1.title yt-formatted-string"
    );

    if (videoId !== this.lastKnownVideoId) {
      this.lastKnownVideoId = videoId;
      this.lastKnownTitle = null;
    }

    const title = resolvePlayerTitle({
      headingTitle: heading?.textContent,
      documentTitle: document.title,
      previousTitle: this.lastKnownTitle
    });
    this.lastKnownTitle = title;

    return {
      type: "player.state",
      timestamp: Date.now(),
      videoId,
      title,
      currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      duration,
      playing: !video.paused && !video.ended,
      playbackRate: Number.isFinite(video.playbackRate) ? video.playbackRate : 1
    };
  }

  public async applyCommand(command: PlayerCommandMessage): Promise<boolean> {
    const video = this.ensureVideo();

    if (!video) {
      return false;
    }

    switch (command.command) {
      case "play":
        try {
          await video.play();
        } catch (error) {
          console.warn("[youtube-subtitle-companion] video.play() failed", error);
        }
        break;

      case "pause":
        video.pause();
        break;

      case "toggle":
        if (video.paused) {
          try {
            await video.play();
          } catch (error) {
            console.warn("[youtube-subtitle-companion] video.play() failed", error);
          }
        } else {
          video.pause();
        }
        break;

      case "seek_relative":
        video.currentTime = clampRelativeSeek(video.currentTime, command.seconds, video.duration);
        break;

      case "seek_absolute":
        video.currentTime = clampTime(command.seconds, video.duration);
        break;

      case "set_playback_rate":
        video.playbackRate = command.rate;
        break;
    }

    this.emitState();
    return true;
  }

  private ensureVideo(): HTMLVideoElement | null {
    if (this.video?.isConnected) {
      return this.video;
    }

    this.refreshVideo();
    return this.video;
  }

  private refreshVideo(forceEmit = false): void {
    const nextVideo = document.querySelector<HTMLVideoElement>("video");

    if (nextVideo === this.video) {
      if (forceEmit) {
        this.emitState();
      }

      return;
    }

    this.detachVideo();
    this.video = nextVideo;

    if (this.video) {
      for (const eventName of VIDEO_EVENTS) {
        this.video.addEventListener(eventName, this.videoListener);
      }
    }

    if (forceEmit) {
      this.emitState();
    }
  }

  private detachVideo(): void {
    if (!this.video) {
      return;
    }

    for (const eventName of VIDEO_EVENTS) {
      this.video.removeEventListener(eventName, this.videoListener);
    }

    this.video = null;
  }

  private emitState(): void {
    const state = this.getState();

    if (state) {
      this.onState(state);
    }
  }
}
