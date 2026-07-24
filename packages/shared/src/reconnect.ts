const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000] as const;

export const getReconnectDelay = (attempt: number): number => {
  if (attempt <= 0) {
    return RECONNECT_DELAYS_MS[0];
  }

  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
};

export { RECONNECT_DELAYS_MS };
