import { afterEach, describe, expect, it, vi } from "vitest";

import { DictionaryService, FreeDictionaryProvider } from "./dictionary";

const createJsonResponse = (status: number, payload: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: vi.fn().mockResolvedValue(payload)
});

describe("FreeDictionaryProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("parses a successful dictionary response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(
          createJsonResponse(200, [
            {
              phonetic: "/dɪˈveləpmənt/",
              meanings: [
                {
                  partOfSpeech: "noun",
                  definitions: [
                    {
                      definition: "the process of developing"
                    },
                    {
                      definition: "growth or progress"
                    }
                  ]
                }
              ]
            }
          ])
        )
        .mockResolvedValueOnce(
          createJsonResponse(200, {
            responseData: {
              translatedText: "sự phát triển"
            }
          })
        )
    );

    const result = await new FreeDictionaryProvider().lookup("development");

    expect(result).toEqual({
      word: "development",
      shortTranslation: "sự phát triển",
      phonetic: "/dɪˈveləpmənt/",
      meanings: [
        {
          partOfSpeech: "noun",
          definitions: ["the process of developing", "growth or progress"]
        }
      ],
      source: "dictionaryapi.dev"
    });
  });

  it("keeps the English dictionary result when the Vietnamese gloss fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(
          createJsonResponse(200, [
            {
              phonetic: "/wɔː/",
              meanings: [
                {
                  partOfSpeech: "noun",
                  definitions: [
                    {
                      definition: "organized armed conflict"
                    }
                  ]
                }
              ]
            }
          ])
        )
        .mockRejectedValueOnce(new Error("translation provider unavailable"))
    );

    const result = await new FreeDictionaryProvider().lookup("war");

    expect(result).toEqual({
      word: "war",
      phonetic: "/wɔː/",
      meanings: [
        {
          partOfSpeech: "noun",
          definitions: ["organized armed conflict"]
        }
      ],
      source: "dictionaryapi.dev"
    });
  });

  it("maps a 404 response to a not_found error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(createJsonResponse(404, {})));

    await expect(new FreeDictionaryProvider().lookup("zzzzword")).rejects.toMatchObject({
      code: "not_found"
    });
  });

  it("maps abort errors to timeout failures", async () => {
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));

    await expect(new FreeDictionaryProvider().lookup("development")).rejects.toMatchObject({
      code: "timeout"
    });
  });

  it("maps other fetch failures to network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")));

    await expect(new FreeDictionaryProvider().lookup("development")).rejects.toMatchObject({
      code: "network"
    });
  });
});

describe("DictionaryService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("caches successful lookups", async () => {
    const provider = {
      lookup: vi.fn().mockResolvedValue({
        word: "development",
        meanings: [
          {
            definitions: ["the process of developing"]
          }
        ]
      })
    };
    const service = new DictionaryService(provider);

    const first = await service.lookup("development");
    const second = await service.lookup("Development");

    expect(first).toEqual(second);
    expect(provider.lookup).toHaveBeenCalledTimes(1);
  });
});
