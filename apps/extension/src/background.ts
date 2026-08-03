import { extensionLogger } from "./logger";

type SpeakSubtitleMessage = {
  type: "tts:speak";
  text: string;
  language?: "en-US" | "vi-VN";
};

type SpeakSubtitleResponse = {
  success: boolean;
  error?: string;
};

type ContentScriptPingMessage = {
  type: "ysc:content-script-ping";
};

type ContentScriptPingResponse = {
  ok: true;
};

const CONTENT_SCRIPT_PING = "ysc:content-script-ping";
const YOUTUBE_URL_PATTERNS = ["https://www.youtube.com/*"];

const queryYouTubeTabs = async (): Promise<chrome.tabs.Tab[]> =>
  new Promise((resolve) => {
    chrome.tabs.query(
      {
        url: YOUTUBE_URL_PATTERNS
      },
      (tabs) => {
        if (chrome.runtime.lastError) {
          extensionLogger.warn("Failed to query YouTube tabs for content-script reinjection", {
            error: chrome.runtime.lastError.message
          });
          resolve([]);
          return;
        }

        resolve(Array.isArray(tabs) ? tabs : []);
      }
    );
  });

const pingContentScript = async (tabId: number): Promise<boolean> =>
  new Promise((resolve) => {
    const message: ContentScriptPingMessage = {
      type: CONTENT_SCRIPT_PING
    };

    chrome.tabs.sendMessage(tabId, message, (response?: ContentScriptPingResponse) => {
      if (chrome.runtime.lastError) {
        resolve(false);
        return;
      }

      resolve(response?.ok === true);
    });
  });

const injectContentScript = async (tabId: number): Promise<void> =>
  new Promise((resolve) => {
    chrome.scripting.executeScript(
      {
        target: {
          tabId
        },
        files: ["content.js"]
      },
      () => {
        if (chrome.runtime.lastError) {
          extensionLogger.warn("Failed to inject content script into existing YouTube tab", {
            tabId,
            error: chrome.runtime.lastError.message
          });
          resolve();
          return;
        }

        extensionLogger.debug("Injected content script into existing YouTube tab", {
          tabId
        });
        resolve();
      }
    );
  });

const ensureContentScriptReadyOnYouTubeTabs = async (): Promise<void> => {
  const tabs = await queryYouTubeTabs();

  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== "number") {
        return;
      }

      const isReady = await pingContentScript(tab.id);

      if (isReady) {
        return;
      }

      await injectContentScript(tab.id);
    })
  );
};

const getTtsVoices = async (): Promise<chrome.tts.TtsVoice[]> =>
  new Promise((resolve) => {
    chrome.tts.getVoices((voices) => {
      resolve(Array.isArray(voices) ? voices : []);
    });
  });

const selectVoice = (
  voices: chrome.tts.TtsVoice[],
  language: "en-US" | "vi-VN" | undefined
): chrome.tts.TtsVoice | null => {
  if (voices.length === 0) {
    return null;
  }

  if (!language) {
    return voices[0] ?? null;
  }

  const exactMatch = voices.find((voice) => voice.lang === language);

  if (exactMatch) {
    return exactMatch;
  }

  const localeMatch = voices.find((voice) => voice.lang?.startsWith(language.split("-")[0] ?? ""));

  return localeMatch ?? voices[0] ?? null;
};

const isSpeakSubtitleMessage = (value: unknown): value is SpeakSubtitleMessage => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const message = value as Record<string, unknown>;
  return (
    message.type === "tts:speak" &&
    typeof message.text === "string" &&
    message.text.trim().length > 0 &&
    (message.language === undefined || message.language === "en-US" || message.language === "vi-VN")
  );
};

void ensureContentScriptReadyOnYouTubeTabs();

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isSpeakSubtitleMessage(message)) {
    return false;
  }

  void (async () => {
    const text = message.text.trim();
    let responded = false;

    const respondOnce = (response: SpeakSubtitleResponse) => {
      if (responded) {
        return;
      }

      responded = true;
      sendResponse(response);
    };

    try {
      const voices = await getTtsVoices();

      if (voices.length === 0) {
        respondOnce({
          success: false,
          error:
            "Chrome reports no usable TTS voices. On Linux, Chrome has no built-in speech engine, so you need a TTS engine extension or another voice backend."
        });
        return;
      }

      const selectedVoice = selectVoice(voices, message.language);

      if (!selectedVoice) {
        respondOnce({
          success: false,
          error: "Chrome could not find a usable TTS voice."
        });
        return;
      }

      chrome.tts.stop();

      chrome.tts.speak(
        text,
        {
          lang: selectedVoice.lang || message.language,
          voiceName: selectedVoice.voiceName,
          enqueue: false,
          onEvent: (event) => {
            if (event.type === "error") {
              respondOnce({
                success: false,
                error: event.errorMessage || "Speech playback failed."
              });
            }
          }
        },
        () => {
          if (chrome.runtime.lastError) {
            respondOnce({
              success: false,
              error: chrome.runtime.lastError.message
            });
            return;
          }

          respondOnce({
            success: true
          });
        }
      );
    } catch (error) {
      respondOnce({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  })();

  return true;
});
