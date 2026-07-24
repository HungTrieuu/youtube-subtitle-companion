import type { PlayerStateMessage } from "@youtube-subtitle-companion/shared";

export type CaptionTrackDescriptor = {
  baseUrl: string;
  kind: string | null;
  languageCode: string | null;
  vssId: string | null;
};

export type CaptionTracksEventDetail = {
  videoId: string | null;
  source: string;
  tracks: CaptionTrackDescriptor[];
};

export type TranscriptRequestEventDetail = {
  requestId: string;
  videoId: string;
  baseUrl: string;
};

export type TranscriptResponseEventDetail = {
  requestId: string;
  videoId: string;
  url: string | null;
  body: string | null;
  error: string | null;
};

export type TimedtextObservedEventDetail = {
  videoId: string | null;
  url: string;
  body: string;
  source: "fetch" | "xhr";
};

export type SubtitlePayload = {
  text: string;
  currentTime: number;
  videoId: string;
};

export type SubtitleContext = Pick<PlayerStateMessage, "currentTime" | "videoId">;

export interface SubtitleReader {
  start(onSubtitle: (subtitle: SubtitlePayload | null) => void): void;
  stop(): void;
  reset(): void;
}
