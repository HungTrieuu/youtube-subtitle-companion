import type { PlayerStateMessage } from "./protocol";

export type SourceCandidate = {
  connectionId: string;
  connectedAt: number;
  lastMessageAt: number;
  lastPlayerStateAt: number | null;
  playerState: PlayerStateMessage | null;
};

const byDescending = (left: number, right: number): number => right - left;

export const selectActiveSource = (candidates: SourceCandidate[]): SourceCandidate | null => {
  if (candidates.length === 0) {
    return null;
  }

  const playing = candidates.filter((candidate) => candidate.playerState?.playing);

  if (playing.length > 0) {
    const sortedPlaying = [...playing].sort((left, right) => {
      return (
        byDescending(left.lastPlayerStateAt ?? 0, right.lastPlayerStateAt ?? 0) ||
        byDescending(left.lastMessageAt, right.lastMessageAt) ||
        byDescending(left.connectedAt, right.connectedAt)
      );
    });

    return sortedPlaying[0] ?? null;
  }

  const sortedCandidates = [...candidates].sort((left, right) => {
    return (
      byDescending(left.connectedAt, right.connectedAt) ||
      byDescending(left.lastMessageAt, right.lastMessageAt)
    );
  });

  return sortedCandidates[0] ?? null;
};
