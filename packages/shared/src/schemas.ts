import { z } from "zod";

import type {
  ElectronToExtensionMessage,
  ExtensionToElectronMessage
} from "./protocol";

const baseMessageSchema = z.object({
  type: z.string(),
  timestamp: z.number().finite()
});

export const extensionHelloSchema = baseMessageSchema.extend({
  type: z.literal("extension.hello"),
  clientId: z.string().min(1),
  version: z.string().min(1)
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
  currentTime: z.number().min(0)
});

export const subtitleClearSchema = baseMessageSchema.extend({
  type: z.literal("subtitle.clear"),
  videoId: z.string().min(1)
});

export const subtitleTimelineCueSchema = z.object({
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  text: z.string().min(1)
});

export const subtitleTimelineSchema = baseMessageSchema.extend({
  type: z.literal("subtitle.timeline"),
  videoId: z.string().min(1),
  cues: z.array(subtitleTimelineCueSchema).min(1)
});

export const extensionToElectronSchema = z.discriminatedUnion("type", [
  extensionHelloSchema,
  playerStateSchema,
  subtitleUpdateSchema,
  subtitleClearSchema,
  subtitleTimelineSchema
]);

export const playerCommandSchema = z.discriminatedUnion("command", [
  baseMessageSchema.extend({
    type: z.literal("player.command"),
    command: z.literal("play")
  }),
  baseMessageSchema.extend({
    type: z.literal("player.command"),
    command: z.literal("pause")
  }),
  baseMessageSchema.extend({
    type: z.literal("player.command"),
    command: z.literal("toggle")
  }),
  baseMessageSchema.extend({
    type: z.literal("player.command"),
    command: z.literal("seek_relative"),
    seconds: z.number().finite()
  }),
  baseMessageSchema.extend({
    type: z.literal("player.command"),
    command: z.literal("seek_absolute"),
    seconds: z.number().finite()
  }),
  baseMessageSchema.extend({
    type: z.literal("player.command"),
    command: z.literal("set_playback_rate"),
    rate: z.number().positive().finite()
  })
]);

export const electronToExtensionSchema = playerCommandSchema;

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
