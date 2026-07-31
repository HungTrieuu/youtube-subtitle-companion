import type { CaptionTrackDescriptor } from "../types";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const getRecord = (value: unknown, key: string): Record<string, unknown> | null => {
  const record = asRecord(value);
  return record ? asRecord(record[key]) : null;
};

const getArray = (value: unknown, key: string): unknown[] => {
  const record = asRecord(value);
  const candidate = record?.[key];
  return Array.isArray(candidate) ? candidate : [];
};

const getString = (value: unknown, key: string): string | null => {
  const record = asRecord(value);
  const candidate = record?.[key];
  return typeof candidate === "string" ? candidate : null;
};

const parsePlayerResponseJson = (value: string | null): unknown => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const getReflectValue = (target: object | null, key: string): unknown => {
  if (!target) {
    return null;
  }

  try {
    return Reflect.get(target, key);
  } catch {
    return null;
  }
};

export const resolveCaptionTracks = (playerResponse: unknown): CaptionTrackDescriptor[] => {
  const captions = getRecord(playerResponse, "captions");
  const renderer = getRecord(captions, "playerCaptionsTracklistRenderer");
  const tracks = getArray(renderer, "captionTracks");

  return tracks.flatMap((track): CaptionTrackDescriptor[] => {
    const baseUrl = getString(track, "baseUrl");

    if (!baseUrl) {
      return [];
    }

    return [
      {
        baseUrl,
        kind: getString(track, "kind"),
        languageCode: getString(track, "languageCode"),
        vssId: getString(track, "vssId")
      }
    ];
  });
};

export const selectCaptionTrack = (tracks: CaptionTrackDescriptor[]): CaptionTrackDescriptor | null => {
  if (tracks.length === 0) {
    return null;
  }

  const sorted = [...tracks].sort((left, right) => {
    const leftIsManual = left.kind !== "asr";
    const rightIsManual = right.kind !== "asr";

    if (leftIsManual !== rightIsManual) {
      return leftIsManual ? -1 : 1;
    }

    return 0;
  });

  return sorted[0] ?? null;
};

export const readPlayerResponse = (): unknown => {
  const globalWindow = window as Window &
    typeof globalThis & {
      ytInitialPlayerResponse?: unknown;
      ytplayer?: {
        config?: {
          args?: Record<string, string | undefined>;
        };
      };
    };

  if (globalWindow.ytInitialPlayerResponse) {
    return globalWindow.ytInitialPlayerResponse;
  }

  const args = globalWindow.ytplayer?.config?.args;
  const rawPlayerResponse =
    typeof args?.raw_player_response === "string"
      ? args.raw_player_response
      : typeof args?.player_response === "string"
        ? args.player_response
        : null;
  const parsedArgsResponse = parsePlayerResponseJson(rawPlayerResponse);

  if (parsedArgsResponse) {
    return parsedArgsResponse;
  }

  const watchFlexy = document.querySelector("ytd-watch-flexy");
  if (!watchFlexy) {
    return null;
  }

  const playerResponse =
    getReflectValue(watchFlexy, "playerResponse") ??
    getReflectValue(watchFlexy, "playerData") ??
    getReflectValue(watchFlexy, "data");

  if (playerResponse) {
    return playerResponse;
  }

  const watchFlexyData = asRecord(getReflectValue(watchFlexy, "data"));
  return watchFlexyData?.playerResponse ?? null;
};
