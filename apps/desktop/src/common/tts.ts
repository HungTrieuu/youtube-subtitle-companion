import { z } from "zod";

export const speechLanguageSchema = z.enum(["en-US", "vi-VN"]);

export const speakSubtitleRequestSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  language: speechLanguageSchema.optional()
});

export const speakSubtitleErrorCodeSchema = z.enum([
  "invalid_text",
  "unavailable",
  "unsupported",
  "speak_failed"
]);

export const speakSubtitleResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true)
  }),
  z.object({
    success: z.literal(false),
    code: speakSubtitleErrorCodeSchema,
    error: z.string().min(1)
  })
]);

export type SpeechLanguage = z.infer<typeof speechLanguageSchema>;
export type SpeakSubtitleRequest = z.infer<typeof speakSubtitleRequestSchema>;
export type SpeakSubtitleResponse = z.infer<typeof speakSubtitleResponseSchema>;
