import type {
  ElectronToExtensionMessage,
  ExtensionCapability,
  ExtensionHelloMessage,
  ExtensionToElectronMessage,
  PlayerCommandMessage,
  PlayerCommandName,
  PlayerCommandResultMessage
} from "./schemas";

export const PROTOCOL_VERSION = "0.1.0";

export {
  EXTENSION_CAPABILITIES,
  type ElectronToExtensionMessage,
  type ExtensionCapability,
  type ExtensionHelloMessage,
  type ExtensionToElectronMessage,
  type PlayerCommandMessage,
  type PlayerCommandName,
  type PlayerCommandResultMessage,
  type PlayerStateMessage,
  type SubtitleClearMessage,
  type SubtitleTimelineCue,
  type SubtitleTimelineMessage,
  type SubtitleTimelineSegment,
  type SubtitleUpdateMessage
} from "./schemas";

export const DEFAULT_EXTENSION_CAPABILITIES: readonly ExtensionCapability[] = [
  "subtitle.current",
  "subtitle.timeline",
  "player.toggle",
  "player.seek",
  "player.rate",
  "video.metadata",
  "player.command-ack"
];

export const createTimestamp = (): number => Date.now();

export const createHelloMessage = (
  clientId: string,
  version = PROTOCOL_VERSION,
  capabilities: readonly ExtensionCapability[] = DEFAULT_EXTENSION_CAPABILITIES
): ExtensionHelloMessage => ({
  type: "extension.hello",
  timestamp: createTimestamp(),
  clientId,
  version,
  capabilities: [...capabilities]
});

type PlayerCommandEnvelope = Pick<PlayerCommandMessage, "type" | "timestamp" | "requestId">;

const createPlayerCommandEnvelope = (
  requestId?: string
): PlayerCommandEnvelope => ({
  type: "player.command",
  timestamp: createTimestamp(),
  ...(requestId ? { requestId } : {})
});

export const createPlayCommand = (
  requestId?: string
): Extract<PlayerCommandMessage, { command: "play" }> => ({
  ...createPlayerCommandEnvelope(requestId),
  command: "play"
});

export const createPauseCommand = (
  requestId?: string
): Extract<PlayerCommandMessage, { command: "pause" }> => ({
  ...createPlayerCommandEnvelope(requestId),
  command: "pause"
});

export const createToggleCommand = (
  requestId?: string
): Extract<PlayerCommandMessage, { command: "toggle" }> => ({
  ...createPlayerCommandEnvelope(requestId),
  command: "toggle"
});

export const createSeekRelativeCommand = (
  seconds: number,
  requestId?: string
): Extract<PlayerCommandMessage, { command: "seek_relative" }> => ({
  ...createPlayerCommandEnvelope(requestId),
  command: "seek_relative",
  seconds
});

export const createSeekAbsoluteCommand = (
  seconds: number,
  requestId?: string
): Extract<PlayerCommandMessage, { command: "seek_absolute" }> => ({
  ...createPlayerCommandEnvelope(requestId),
  command: "seek_absolute",
  seconds
});

export const createSetPlaybackRateCommand = (
  rate: number,
  requestId?: string
): Extract<PlayerCommandMessage, { command: "set_playback_rate" }> => ({
  ...createPlayerCommandEnvelope(requestId),
  command: "set_playback_rate",
  rate
});

export const createPlayerCommandResultMessage = (
  requestId: string,
  success: boolean,
  error?: string
): PlayerCommandResultMessage => ({
  type: "player.command_result",
  timestamp: createTimestamp(),
  requestId,
  success,
  ...(error ? { error } : {})
});

export const supportsCapability = (
  hello: Pick<ExtensionHelloMessage, "capabilities"> | null | undefined,
  capability: ExtensionCapability
): boolean => hello?.capabilities?.includes(capability) ?? false;
