import type { PlayerStateMessage } from "@youtube-subtitle-companion/shared";
import { selectActiveSource } from "@youtube-subtitle-companion/shared";

export type ActiveSourceCandidate = {
  connectionId: string;
  connectedAt: number;
  lastMessageAt: number;
  lastPlayerStateAt: number | null;
  playerState: PlayerStateMessage | null;
};

export const summarizeCommandlessState = (record: {
  connectionId: string;
  hello: {
    clientId: string;
    version: string;
  } | null;
  playerState: PlayerStateMessage | null;
}) => ({
  connectionId: record.connectionId,
  clientId: record.hello?.clientId ?? null,
  version: record.hello?.version ?? null,
  videoId: record.playerState?.videoId ?? null,
  title: record.playerState?.title ?? null,
  playing: record.playerState?.playing ?? null,
  playbackRate: record.playerState?.playbackRate ?? null
});

export const selectActiveConnectionId = (
  candidates: ActiveSourceCandidate[]
): string | null =>
  selectActiveSource(candidates)?.connectionId ?? null;
