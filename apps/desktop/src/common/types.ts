import { playerStateSchema, subtitleUpdateSchema } from "@youtube-subtitle-companion/shared";
import { z } from "zod";

export const textAlignmentSchema = z.enum(["left", "center", "right"]);
export const overlaySourceStatusSchema = z.enum([
  "waiting_for_extension",
  "waiting_for_player",
  "waiting_for_subtitle",
  "receiving_subtitles"
]);
export const overlayUiModeSchema = z.enum(["click_through", "active", "move"]);

export const appHotkeysSchema = z.object({
  togglePlay: z.string().min(1),
  toggleSystemMedia: z.string().min(1),
  seekBack: z.string().min(1),
  seekForward: z.string().min(1),
  toggleOverlay: z.string().min(1),
  toggleInteraction: z.string().min(1),
  moveOverlay: z.string().min(1),
  temporaryDim: z.string().min(1),
  increaseFont: z.string().min(1),
  decreaseFont: z.string().min(1)
});

export const appConfigSchema = z.object({
  overlayVisible: z.boolean(),
  clickThrough: z.boolean(),
  fontSize: z.number().int().min(16).max(64),
  opacity: z.number().min(0.3).max(1),
  width: z.number().int().min(320).max(2200),
  height: z.number().int().min(80).max(600),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  alignment: textAlignmentSchema,
  autoStart: z.boolean(),
  hotkeys: appHotkeysSchema
});

export const appConfigPatchSchema = appConfigSchema.partial().extend({
  hotkeys: appHotkeysSchema.partial().optional()
});

export const overlayConnectionStateSchema = z.object({
  connected: z.boolean(),
  clientCount: z.number().int().min(0),
  activeConnectionId: z.string().min(1).nullable(),
  clientId: z.string().min(1).nullable(),
  extensionVersion: z.string().min(1).nullable(),
  sourceTitle: z.string().nullable(),
  sourceVideoId: z.string().min(1).nullable(),
  sourcePlaying: z.boolean().nullable(),
  sourcePlaybackRate: z.number().finite().nullable(),
  lastHelloAt: z.number().finite().nullable(),
  lastMessageAt: z.number().finite().nullable(),
  lastPlayerStateAt: z.number().finite().nullable(),
  lastSubtitleAt: z.number().finite().nullable(),
  status: overlaySourceStatusSchema
});

export const overlayUiStateSchema = z.object({
  mode: overlayUiModeSchema
});

export const overlayInitialStateSchema = z.object({
  subtitle: subtitleUpdateSchema.nullable(),
  playerState: playerStateSchema.nullable(),
  config: appConfigSchema,
  connection: overlayConnectionStateSchema,
  uiState: overlayUiStateSchema
});

export type TextAlignment = z.infer<typeof textAlignmentSchema>;
export type OverlaySourceStatus = z.infer<typeof overlaySourceStatusSchema>;
export type OverlayUiMode = z.infer<typeof overlayUiModeSchema>;
export type AppConfig = z.infer<typeof appConfigSchema>;
export type AppConfigPatch = z.infer<typeof appConfigPatchSchema>;
export type OverlayConnectionState = z.infer<typeof overlayConnectionStateSchema>;
export type OverlayInitialState = z.infer<typeof overlayInitialStateSchema>;
export type OverlayUiState = z.infer<typeof overlayUiStateSchema>;
