export const clampTime = (value: number, duration: number): number => {
  const safeValue = Number.isFinite(value) ? value : 0;

  if (!Number.isFinite(duration) || duration <= 0) {
    return Math.max(0, safeValue);
  }

  return Math.min(Math.max(0, safeValue), duration);
};

export const clampRelativeSeek = (
  currentTime: number,
  deltaSeconds: number,
  duration: number
): number => clampTime(currentTime + deltaSeconds, duration);
