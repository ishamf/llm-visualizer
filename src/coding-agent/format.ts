const tokenFormatter = new Intl.NumberFormat('en-US');

export function formatTokens(count: number): string {
  return tokenFormatter.format(Math.round(count));
}

/** `1:23` style playback clock. */
export function formatClock(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const totalSeconds = Math.floor(clamped);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function formatCost(amount: number): string {
  return `$${amount.toFixed(amount >= 0.01 ? 4 : 5)}`;
}
