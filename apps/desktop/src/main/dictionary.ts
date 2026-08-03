import type {
  DictionaryLookupResponse,
  DictionaryProvider,
  DictionaryResult
} from "../common/learning";
import { normalizeLearningWord } from "../common/learning";
import { logger } from "./logger";

const DICTIONARY_LOOKUP_TIMEOUT_MS = 5_000;
const DICTIONARY_SOURCE = "dictionaryapi.dev";
const DICTIONARY_ENDPOINT = "https://api.dictionaryapi.dev/api/v2/entries/en";
const TRANSLATION_LOOKUP_TIMEOUT_MS = 2_500;
const TRANSLATION_ENDPOINT = "https://api.mymemory.translated.net/get";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getText = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

const normalizeTranslatedText = (sourceText: string, value: unknown): string | undefined => {
  const text = getText(value);

  if (!text || text.toLowerCase() === sourceText.toLowerCase()) {
    return undefined;
  }

  return text;
};

const extractPhonetic = (entries: unknown[]): string | undefined => {
  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue;
    }

    const direct = getText(entry.phonetic);
    if (direct) {
      return direct;
    }

    if (!Array.isArray(entry.phonetics)) {
      continue;
    }

    for (const phonetic of entry.phonetics) {
      if (!isRecord(phonetic)) {
        continue;
      }

      const text = getText(phonetic.text);
      if (text) {
        return text;
      }
    }
  }

  return undefined;
};

const extractMeanings = (entries: unknown[]): DictionaryResult["meanings"] => {
  const meanings: DictionaryResult["meanings"] = [];

  for (const entry of entries) {
    if (!isRecord(entry) || !Array.isArray(entry.meanings)) {
      continue;
    }

    for (const rawMeaning of entry.meanings) {
      if (!isRecord(rawMeaning) || !Array.isArray(rawMeaning.definitions)) {
        continue;
      }

      const definitions = rawMeaning.definitions
        .map((definition) => {
          if (!isRecord(definition)) {
            return undefined;
          }

          return getText(definition.definition);
        })
        .filter((definition): definition is string => Boolean(definition));

      if (definitions.length === 0) {
        continue;
      }

      meanings.push({
        partOfSpeech: getText(rawMeaning.partOfSpeech),
        definitions
      });
    }
  }

  return meanings;
};

const extractTranslation = (sourceText: string, payload: unknown): string | undefined => {
  const root = getRecord(payload);
  const responseData = getRecord(root?.responseData);
  const direct = normalizeTranslatedText(sourceText, responseData?.translatedText);

  if (direct) {
    return direct;
  }

  if (!Array.isArray(root?.matches)) {
    return undefined;
  }

  for (const match of root.matches) {
    if (!isRecord(match)) {
      continue;
    }

    const translation = normalizeTranslatedText(sourceText, match.translation);

    if (translation) {
      return translation;
    }
  }

  return undefined;
};

export class FreeDictionaryProvider implements DictionaryProvider {
  public async lookup(word: string): Promise<DictionaryResult> {
    const dictionaryPromise = this.lookupEnglishDictionary(word);
    const translationPromise = this.lookupVietnameseTranslation(word).catch((error: unknown) => {
      logger.debug("dictionary", "Vietnamese word translation lookup failed", {
        word,
        error: error instanceof Error ? error.message : String(error)
      });

      return undefined;
    });

    const result = await dictionaryPromise;
    const shortTranslation = await translationPromise;

    return {
      ...result,
      shortTranslation
    };
  }

  public async translateText(sourceText: string): Promise<string | undefined> {
    return this.lookupVietnameseTranslation(sourceText).catch((error: unknown) => {
      logger.debug("dictionary", "Vietnamese sentence translation lookup failed", {
        sentence: sourceText,
        error: error instanceof Error ? error.message : String(error)
      });

      return undefined;
    });
  }

  private async lookupEnglishDictionary(word: string): Promise<DictionaryResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, DICTIONARY_LOOKUP_TIMEOUT_MS);

    try {
      const response = await fetch(`${DICTIONARY_ENDPOINT}/${encodeURIComponent(word)}`, {
        signal: controller.signal,
        headers: {
          Accept: "application/json"
        }
      });
      const payload = await response.json().catch(() => null);

      if (response.status === 404) {
        throw new DictionaryLookupError("not_found", "No definition found for this word.");
      }

      if (!response.ok) {
        throw new DictionaryLookupError(
          "lookup_error",
          `Dictionary provider returned HTTP ${response.status}.`
        );
      }

      if (!Array.isArray(payload)) {
        throw new DictionaryLookupError(
          "lookup_error",
          "Dictionary provider returned an unexpected response."
        );
      }

      const meanings = extractMeanings(payload);

      if (meanings.length === 0) {
        throw new DictionaryLookupError(
          "lookup_error",
          "Dictionary provider returned no usable definitions."
        );
      }

      return {
        word,
        phonetic: extractPhonetic(payload),
        meanings,
        source: DICTIONARY_SOURCE
      };
    } catch (error) {
      if (error instanceof DictionaryLookupError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new DictionaryLookupError("timeout", "Dictionary lookup timed out.");
      }

      throw new DictionaryLookupError("network", "Network error while looking up the word.");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async lookupVietnameseTranslation(sourceText: string): Promise<string | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, TRANSLATION_LOOKUP_TIMEOUT_MS);

    try {
      const response = await fetch(
        `${TRANSLATION_ENDPOINT}?q=${encodeURIComponent(sourceText)}&langpair=en|vi`,
        {
          signal: controller.signal,
          headers: {
            Accept: "application/json"
          }
        }
      );
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(`Translation provider returned HTTP ${response.status}.`);
      }

      return extractTranslation(sourceText, payload);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class DictionaryService {
  private readonly wordCache = new Map<string, DictionaryLookupResponse>();
  private readonly wordInflight = new Map<string, Promise<DictionaryLookupResponse>>();
  private readonly sentenceCache = new Map<string, string | undefined>();
  private readonly sentenceInflight = new Map<string, Promise<string | undefined>>();

  public constructor(
    private readonly provider: DictionaryProvider = new FreeDictionaryProvider()
  ) {}

  public async lookup(rawWord: string): Promise<DictionaryLookupResponse> {
    return this.lookupWithContext({
      word: rawWord
    });
  }

  public async lookupWithContext(request: {
    word: string;
    sentence?: string;
  }): Promise<DictionaryLookupResponse> {
    const word = normalizeLearningWord(request.word);
    const sentence = request.sentence?.trim() || undefined;

    if (!word) {
      return {
        success: false,
        code: "invalid_word",
        error: "The selected token is not a valid learning word."
      };
    }

    const dictionaryResponse = await this.lookupWord(word);

    if (!dictionaryResponse.success) {
      return dictionaryResponse;
    }

    if (!sentence) {
      return dictionaryResponse;
    }

    const sentenceTranslation = await this.lookupSentenceTranslation(sentence);

    if (!sentenceTranslation) {
      return dictionaryResponse;
    }

    return {
      success: true,
      result: {
        ...dictionaryResponse.result,
        sentenceTranslation
      }
    };
  }

  private lookupWord(word: string): Promise<DictionaryLookupResponse> {
    const cached = this.wordCache.get(word);
    if (cached) {
      return Promise.resolve(cached);
    }

    const inflight = this.wordInflight.get(word);
    if (inflight) {
      return inflight;
    }

    const request = this.provider
      .lookup(word)
      .then<DictionaryLookupResponse>((result) => {
        const response = {
          success: true,
          result
        } as const;

        this.wordCache.set(word, response);
        return response;
      })
      .catch<DictionaryLookupResponse>((error: unknown) => {
        const response =
          error instanceof DictionaryLookupError
            ? {
                success: false,
                code: error.code,
                error: error.message
              }
            : {
                success: false,
                code: "lookup_error" as const,
                error: "Dictionary lookup failed."
              };

        if (response.code === "not_found") {
          this.wordCache.set(word, response);
        }

        logger.warn("dictionary", "Dictionary lookup failed", {
          word,
          code: response.code,
          error: response.error
        });

        return response;
      })
      .finally(() => {
        this.wordInflight.delete(word);
      });

    this.wordInflight.set(word, request);
    return request;
  }

  private lookupSentenceTranslation(sentence: string): Promise<string | undefined> {
    if (!this.provider.translateText) {
      return Promise.resolve(undefined);
    }

    if (this.sentenceCache.has(sentence)) {
      return Promise.resolve(this.sentenceCache.get(sentence));
    }

    const inflight = this.sentenceInflight.get(sentence);
    if (inflight) {
      return inflight;
    }

    const request = this.provider
      .translateText(sentence)
      .then((translation) => {
        this.sentenceCache.set(sentence, translation);
        return translation;
      })
      .catch((error: unknown) => {
        logger.warn("dictionary", "Sentence translation lookup failed", {
          sentence,
          error: error instanceof Error ? error.message : String(error)
        });

        return undefined;
      })
      .finally(() => {
        this.sentenceInflight.delete(sentence);
      });

    this.sentenceInflight.set(sentence, request);
    return request;
  }
}

class DictionaryLookupError extends Error {
  public constructor(
    public readonly code: Exclude<DictionaryLookupResponse, { success: true }>["code"],
    message: string
  ) {
    super(message);
    this.name = "DictionaryLookupError";
  }
}
