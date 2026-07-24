export const PROTOCOL_VERSION = "0.1.0";

export type BaseMessage = {
  type: string;
  timestamp: number;
};

export type ExtensionHelloMessage = BaseMessage & {
  type: "extension.hello";
  clientId: string;
  version: string;
};

export type PlayerStateMessage = BaseMessage & {
  type: "player.state";
  videoId: string;
  title: string;
  currentTime: number;
  duration: number;
  playing: boolean;
  playbackRate: number;
};

export type SubtitleUpdateMessage = BaseMessage & {
  type: "subtitle.update";
  videoId: string;
  text: string;
  currentTime: number;
  cueStartMs?: number;
  cueEndMs?: number;
  segments?: SubtitleTimelineSegment[];
};

export type SubtitleClearMessage = BaseMessage & {
  type: "subtitle.clear";
  videoId: string;
};

export type SubtitleTimelineCue = {
  startMs: number;
  endMs: number;
  text: string;
  segments?: SubtitleTimelineSegment[];
};

export type SubtitleTimelineSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

export type SubtitleTimelineMessage = BaseMessage & {
  type: "subtitle.timeline";
  videoId: string;
  cues: SubtitleTimelineCue[];
};

export type PlayCommandMessage = BaseMessage & {
  type: "player.command";
  command: "play";
};

export type PauseCommandMessage = BaseMessage & {
  type: "player.command";
  command: "pause";
};

export type ToggleCommandMessage = BaseMessage & {
  type: "player.command";
  command: "toggle";
};

export type SeekRelativeCommandMessage = BaseMessage & {
  type: "player.command";
  command: "seek_relative";
  seconds: number;
};

export type SeekAbsoluteCommandMessage = BaseMessage & {
  type: "player.command";
  command: "seek_absolute";
  seconds: number;
};

export type SetPlaybackRateCommandMessage = BaseMessage & {
  type: "player.command";
  command: "set_playback_rate";
  rate: number;
};

export type PlayerCommandMessage =
  | PlayCommandMessage
  | PauseCommandMessage
  | ToggleCommandMessage
  | SeekRelativeCommandMessage
  | SeekAbsoluteCommandMessage
  | SetPlaybackRateCommandMessage;

export type ExtensionToElectronMessage =
  | ExtensionHelloMessage
  | PlayerStateMessage
  | SubtitleUpdateMessage
  | SubtitleClearMessage
  | SubtitleTimelineMessage;

export type ElectronToExtensionMessage = PlayerCommandMessage;

export type PlayerCommandName = PlayerCommandMessage["command"];

export const createTimestamp = (): number => Date.now();

export const createHelloMessage = (
  clientId: string,
  version = PROTOCOL_VERSION
): ExtensionHelloMessage => ({
  type: "extension.hello",
  timestamp: createTimestamp(),
  clientId,
  version
});

export const createPlayCommand = (): PlayCommandMessage => ({
  type: "player.command",
  timestamp: createTimestamp(),
  command: "play"
});

export const createPauseCommand = (): PauseCommandMessage => ({
  type: "player.command",
  timestamp: createTimestamp(),
  command: "pause"
});

export const createToggleCommand = (): ToggleCommandMessage => ({
  type: "player.command",
  timestamp: createTimestamp(),
  command: "toggle"
});

export const createSeekRelativeCommand = (seconds: number): SeekRelativeCommandMessage => ({
  type: "player.command",
  timestamp: createTimestamp(),
  command: "seek_relative",
  seconds
});

export const createSeekAbsoluteCommand = (seconds: number): SeekAbsoluteCommandMessage => ({
  type: "player.command",
  timestamp: createTimestamp(),
  command: "seek_absolute",
  seconds
});

export const createSetPlaybackRateCommand = (rate: number): SetPlaybackRateCommandMessage => ({
  type: "player.command",
  timestamp: createTimestamp(),
  command: "set_playback_rate",
  rate
});
