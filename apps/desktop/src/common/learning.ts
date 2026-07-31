export interface DictionaryProvider {
  lookup(word: string): Promise<DictionaryResult>;
}

export interface DictionaryResult {
  word: string;
  shortTranslation?: string;
  phonetic?: string;
  meanings: Array<{
    partOfSpeech?: string;
    definitions: string[];
  }>;
  source?: string;
}

export type DictionaryLookupResponse =
  | {
      success: true;
      result: DictionaryResult;
    }
  | {
      success: false;
      code: "invalid_word" | "not_found" | "timeout" | "network" | "lookup_error";
      error: string;
    };

export interface LearningItem {
  word: string;
  sentence: string;
  videoId: string | null;
  videoTitle: string | null;
  timestampMs: number;
  savedAt: string;
  status: "new";
}

export interface SaveLearningItemRequest {
  word: string;
  sentence: string;
  videoId: string | null;
  videoTitle: string | null;
  timestampMs: number;
}

export interface DeleteLearningItemRequest {
  word: string;
  sentence: string;
  videoId: string | null;
  videoTitle: string | null;
  timestampMs: number;
  savedAt: string;
  status: "new";
}

export type SaveLearningItemResponse =
  | {
      success: true;
      duplicate: boolean;
    }
  | {
      success: false;
      error: string;
    };

export type LearningItemsResponse =
  | {
      success: true;
      items: LearningItem[];
    }
  | {
      success: false;
      error: string;
    };

export type DeleteLearningItemResponse =
  | {
      success: true;
      deleted: boolean;
    }
  | {
      success: false;
      error: string;
    };

const VALID_LEARNING_WORD = /^[a-z0-9]+(?:['-][a-z0-9]+)*$/i;

export const normalizeLearningWord = (value: string): string | null => {
  const normalized = value.trim().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");

  if (!normalized || !VALID_LEARNING_WORD.test(normalized)) {
    return null;
  }

  return normalized.toLowerCase();
};
