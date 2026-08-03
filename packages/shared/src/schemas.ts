import { z } from "zod";

export const EXTENSION_CAPABILITIES = [
  "subtitle.current",
  "subtitle.timeline",
  "player.toggle",
  "player.seek",
  "player.rate",
  "video.metadata",
  "player.command-ack",
  "speech.tts"
] as const;

const baseMessageSchema = z.object({
  type: z.string(),
  timestamp: z.number().finite()
});

export const extensionHelloSchema = baseMessageSchema.extend({
  type: z.literal("extension.hello"),
  clientId: z.string().min(1),
  version: z.string().min(1),
  capabilities: z.array(z.enum(EXTENSION_CAPABILITIES)).optional()
});

export const playerStateSchema = baseMessageSchema.extend({
  type: z.literal("player.state"),
  videoId: z.string().min(1),
  title: z.string(),
  currentTime: z.number().min(0),
  duration: z.number().min(0),
  playing: z.boolean(),
  playbackRate: z.number().positive()
});

export const subtitleUpdateSchema = baseMessageSchema.extend({
  type: z.literal("subtitle.update"),
  videoId: z.string().min(1),
  text: z.string().min(1),
  currentTime: z.number().min(0),
  cueStartMs: z.number().min(0).optional(),
  cueEndMs: z.number().min(0).optional(),
  segments: z.array(
    z.object({
      startMs: z.number().min(0),
      endMs: z.number().min(0),
      text: z.string().min(1)
    })
  )
    .min(1)
    .optional()
});

export const subtitleClearSchema = baseMessageSchema.extend({
  type: z.literal("subtitle.clear"),
  videoId: z.string().min(1)
});

export const subtitleTimelineSegmentSchema = z.object({
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  text: z.string().min(1)
});

export const subtitleTimelineCueSchema = z.object({
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  text: z.string().min(1),
  segments: z.array(subtitleTimelineSegmentSchema).min(1).optional()
});

export const subtitleTimelineSchema = baseMessageSchema.extend({
  type: z.literal("subtitle.timeline"),
  videoId: z.string().min(1),
  cues: z.array(subtitleTimelineCueSchema).min(1)
});

export const playerCommandResultSchema = baseMessageSchema.extend({
  type: z.literal("player.command_result"),
  requestId: z.string().min(1),
  success: z.boolean(),
  error: z.string().min(1).optional()
});

export const extensionToElectronSchema = z.discriminatedUnion("type", [
  extensionHelloSchema,
  playerStateSchema,
  subtitleUpdateSchema,
  subtitleClearSchema,
  subtitleTimelineSchema,
  playerCommandResultSchema
]);

const playerCommandBaseSchema = baseMessageSchema.extend({
  type: z.literal("player.command"),
  requestId: z.string().min(1).optional()
});

export const playerCommandSchema = z.discriminatedUnion("command", [
  playerCommandBaseSchema.extend({
    command: z.literal("play")
  }),
  playerCommandBaseSchema.extend({
    command: z.literal("pause")
  }),
  playerCommandBaseSchema.extend({
    command: z.literal("toggle")
  }),
  playerCommandBaseSchema.extend({
    command: z.literal("seek_relative"),
    seconds: z.number().finite()
  }),
  playerCommandBaseSchema.extend({
    command: z.literal("seek_absolute"),
    seconds: z.number().finite()
  }),
  playerCommandBaseSchema.extend({
    command: z.literal("set_playback_rate"),
    rate: z.number().positive().finite()
  }),
  playerCommandBaseSchema.extend({
    command: z.literal("speak_text"),
    text: z.string().min(1).max(1000),
    language: z.enum(["en-US", "vi-VN"]).optional()
  })
]);

export const electronToExtensionSchema = playerCommandSchema;

export type ExtensionCapability = (typeof EXTENSION_CAPABILITIES)[number];
export type ExtensionHelloMessage = z.infer<typeof extensionHelloSchema>;
export type PlayerStateMessage = z.infer<typeof playerStateSchema>;
export type SubtitleUpdateMessage = z.infer<typeof subtitleUpdateSchema>;
export type SubtitleClearMessage = z.infer<typeof subtitleClearSchema>;
export type SubtitleTimelineSegment = z.infer<typeof subtitleTimelineSegmentSchema>;
export type SubtitleTimelineCue = z.infer<typeof subtitleTimelineCueSchema>;
export type SubtitleTimelineMessage = z.infer<typeof subtitleTimelineSchema>;
export type PlayerCommandResultMessage = z.infer<typeof playerCommandResultSchema>;
export type ExtensionToElectronMessage = z.infer<typeof extensionToElectronSchema>;
export type PlayerCommandMessage = z.infer<typeof playerCommandSchema>;
export type ElectronToExtensionMessage = z.infer<typeof electronToExtensionSchema>;
export type PlayerCommandName = PlayerCommandMessage["command"];

export const parseExtensionMessage = (
  input: unknown
): ExtensionToElectronMessage | null => {
  const parsed = extensionToElectronSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
};

export const parseElectronMessage = (
  input: unknown
): ElectronToExtensionMessage | null => {
  const parsed = electronToExtensionSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
};
