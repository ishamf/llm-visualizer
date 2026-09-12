const tokenFormatter = new Intl.NumberFormat('en-US');

export function formatTokens(count: number): string {
  return tokenFormatter.format(Math.round(count));
}

/** Decimal kilobytes; small values stay in bytes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const kilobytes = bytes / 1000;
  if (kilobytes < 1000) {
    return `${kilobytes.toFixed(kilobytes < 10 ? 1 : 0)} kB`;
  }
  return `${(kilobytes / 1000).toFixed(2)} MB`;
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

/**
 * Implied price per million tokens, rounded to 3 significant digits with
 * trailing zeros trimmed (`$0.15/M`). Returns a dash when there is no
 * usage or cost to derive a rate from.
 */
export function formatPricePerMillion(cost: number, tokens: number): string {
  if (tokens <= 0 || cost <= 0) return '\u2014';
  const perMillion = (cost / tokens) * 1_000_000;
  if (!Number.isFinite(perMillion)) return '\u2014';
  return `$${Number(perMillion.toPrecision(3))}/M`;
}
