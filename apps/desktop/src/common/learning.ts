import { z } from "zod";

export interface DictionaryProvider {
  lookup(word: string): Promise<DictionaryResult>;
  translateText?(sourceText: string): Promise<string | undefined>;
}

export const dictionaryMeaningSchema = z.object({
  partOfSpeech: z.string().min(1).optional(),
  definitions: z.array(z.string().min(1))
});

export const dictionaryResultSchema = z.object({
  word: z.string().min(1),
  shortTranslation: z.string().min(1).optional(),
  sentenceTranslation: z.string().min(1).optional(),
  phonetic: z.string().min(1).optional(),
  meanings: z.array(dictionaryMeaningSchema),
  source: z.string().min(1).optional()
});

export const dictionaryLookupCodeSchema = z.enum([
  "invalid_word",
  "not_found",
  "timeout",
  "network",
  "lookup_error"
]);

export const dictionaryLookupRequestSchema = z.object({
  word: z.string().trim().min(1),
  sentence: z.string().trim().min(1).optional()
});

export const dictionaryLookupResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    result: dictionaryResultSchema
  }),
  z.object({
    success: z.literal(false),
    code: dictionaryLookupCodeSchema,
    error: z.string().min(1)
  })
]);

export const learningItemSchema = z.object({
  word: z.string().min(1),
  wordTranslation: z.string().min(1).optional(),
  sentence: z.string().min(1),
  sentenceTranslation: z.string().min(1).optional(),
  videoId: z.string().min(1).nullable(),
  videoTitle: z.string().min(1).nullable(),
  timestampMs: z.number().finite().min(0),
  savedAt: z.string().min(1),
  status: z.literal("new")
});

export const saveLearningItemRequestSchema = learningItemSchema.omit({
  savedAt: true,
  status: true
});

export const deleteLearningItemRequestSchema = learningItemSchema;

export const saveLearningItemResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    duplicate: z.boolean()
  }),
  z.object({
    success: z.literal(false),
    error: z.string().min(1)
  })
]);

export const learningItemsResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    items: z.array(learningItemSchema)
  }),
  z.object({
    success: z.literal(false),
    error: z.string().min(1)
  })
]);

export const deleteLearningItemResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    deleted: z.boolean()
  }),
  z.object({
    success: z.literal(false),
    error: z.string().min(1)
  })
]);

export type DictionaryResult = z.infer<typeof dictionaryResultSchema>;
export type DictionaryLookupRequest = z.infer<typeof dictionaryLookupRequestSchema>;
export type DictionaryLookupResponse = z.infer<typeof dictionaryLookupResponseSchema>;
export type LearningItem = z.infer<typeof learningItemSchema>;
export type SaveLearningItemRequest = z.infer<typeof saveLearningItemRequestSchema>;
export type DeleteLearningItemRequest = z.infer<typeof deleteLearningItemRequestSchema>;
export type SaveLearningItemResponse = z.infer<typeof saveLearningItemResponseSchema>;
export type LearningItemsResponse = z.infer<typeof learningItemsResponseSchema>;
export type DeleteLearningItemResponse = z.infer<typeof deleteLearningItemResponseSchema>;

const VALID_LEARNING_WORD = /^[a-z0-9]+(?:['-][a-z0-9]+)*$/i;

export const normalizeLearningWord = (value: string): string | null => {
  const normalized = value.trim().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");

  if (!normalized || !VALID_LEARNING_WORD.test(normalized)) {
    return null;
  }

  return normalized.toLowerCase();
};
