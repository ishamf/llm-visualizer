import type { PackedSession } from './packed-session.ts';

/**
 * Allocates request costs onto the growing conversation context, so the
 * page can chart "what each slice of the context cost to generate".
 *
 * Model: walking the requests in order, the context after request *n*
 * spans `promptTokens(n) + output(n)` tokens, where prompt tokens are
 * `input + cacheRead + cacheWrite` (the mutually exclusive usage
 * categories). The transcript grows monotonically — prompts are prefixes
 * of one another — so each request *owns* the segment
 * `[context(n-1), context(n))`: the freshly ingested prompt tokens plus
 * the tokens it generated. The request's full cost (uncached input,
 * cached read, cache write, and output) is spread evenly over that
 * segment, which folds the cost of re-reading the earlier context into
 * the tokens the request produced. Recorded token counts fluctuate a
 * little around cache bookkeeping, so the running end is clamped to be
 * non-decreasing; a request that adds no new tokens puts its whole cost
 * into the bucket at the current context end.
 *
 * The series is bucketed into fixed-size windows (1000 context tokens by
 * default); a request straddling a bucket boundary splits its cost
 * proportionally to the overlap. The series does not follow playback — it
 * always covers the whole session.
 *
 * `contextCostWindowSeries` reuses that same allocation, bucketed into
 * 500-token slices, and reports for each slice the total cost of the
 * trailing context window ending at it (`CONTEXT_COST_WINDOW_TOKENS`
 * tokens by default: the slice's own tokens plus the preceding ones,
 * truncated at the start of the session). The buckets partition the
 * context line, so each window total is an exact sum of the allocation;
 * the wide window smooths the per-request spikes of the per-bucket
 * series.
 */

export type ContextCostBucket = {
  /** First context token of the bucket. */
  start: number;
  /** One past the last context token of the bucket. */
  end: number;
  costs: {
    cached: number;
    cacheWrite: number;
    input: number;
    output: number;
    total: number;
  };
};

export type ContextCostSeries = {
  bucketTokens: number;
  /** Total context tokens covered (the end of the last request). */
  contextTokens: number;
  buckets: ContextCostBucket[];
};

export const CONTEXT_COST_BUCKET_TOKENS = 1000;

/** Slice size for the rolling-window series. */
export const CONTEXT_COST_WINDOW_BUCKET_TOKENS = 500;
/** Trailing context window summed into each rolling-window bucket. */
export const CONTEXT_COST_WINDOW_TOKENS = 5000;

const emptyCosts = () => ({
  cached: 0,
  cacheWrite: 0,
  input: 0,
  output: 0,
  total: 0,
});

export function contextCostSeries(
  session: PackedSession,
  bucketTokens: number = CONTEXT_COST_BUCKET_TOKENS,
): ContextCostSeries {
  const buckets: ContextCostBucket[] = [];
  const bucketAt = (index: number): ContextCostBucket => {
    while (buckets.length <= index) {
      const start = buckets.length * bucketTokens;
      buckets.push({ start, end: start + bucketTokens, costs: emptyCosts() });
    }
    return buckets[index];
  };

  let cursor = 0;
  for (const request of session.requests) {
    const usage = request.data.response.usage;
    const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
    const end = Math.max(cursor, promptTokens + usage.output);
    const components: Array<[keyof ContextCostBucket['costs'], number]> = [
      ['cached', usage.cost?.cacheRead ?? 0],
      ['cacheWrite', usage.cost?.cacheWrite ?? 0],
      ['input', usage.cost?.input ?? 0],
      ['output', usage.cost?.output ?? 0],
    ];
    const total = components.reduce((sum, [, amount]) => sum + amount, 0);
    const length = end - cursor;
    if (length <= 0) {
      // No new context: attribute the whole cost to the bucket at the
      // current context end (clamped inside the series).
      const bucket = bucketAt(
        Math.max(0, Math.ceil(cursor / bucketTokens) - 1),
      );
      for (const [key, amount] of components) bucket.costs[key] += amount;
      bucket.costs.total += total;
      continue;
    }
    let position = cursor;
    while (position < end) {
      const bucket = bucketAt(Math.floor(position / bucketTokens));
      const next = Math.min(bucket.end, end);
      const fraction = (next - position) / length;
      for (const [key, amount] of components) {
        bucket.costs[key] += amount * fraction;
      }
      bucket.costs.total += total * fraction;
      position = next;
    }
    cursor = end;
  }

  return { bucketTokens, contextTokens: cursor, buckets };
}

export type ContextCostWindowBucket = {
  /** First context token of the slice. */
  start: number;
  /** One past the last context token of the slice. */
  end: number;
  /** First context token covered by the trailing window. */
  windowStart: number;
  costs: ContextCostBucket['costs'];
};

export type ContextCostWindowSeries = {
  bucketTokens: number;
  windowTokens: number;
  /** Total context tokens covered (the end of the last request). */
  contextTokens: number;
  buckets: ContextCostWindowBucket[];
};

/**
 * Rolling-window view of the per-slice allocation: the cost of the
 * `windowTokens` context tokens ending at each `bucketTokens` slice.
 */
export function contextCostWindowSeries(
  session: PackedSession,
  windowTokens: number = CONTEXT_COST_WINDOW_TOKENS,
  bucketTokens: number = CONTEXT_COST_WINDOW_BUCKET_TOKENS,
): ContextCostWindowSeries {
  const series = contextCostSeries(session, bucketTokens);
  // A window spans this many aligned slices; the bucket partition makes
  // summing them exact.
  const span = Math.max(1, Math.round(windowTokens / bucketTokens));
  const buckets = series.buckets.map((slice, index) => {
    const first = Math.max(0, index - span + 1);
    const costs = emptyCosts();
    for (let i = first; i <= index; i += 1) {
      const part = series.buckets[i].costs;
      costs.cached += part.cached;
      costs.cacheWrite += part.cacheWrite;
      costs.input += part.input;
      costs.output += part.output;
      costs.total += part.total;
    }
    return {
      start: slice.start,
      end: slice.end,
      windowStart: series.buckets[first].start,
      costs,
    };
  });
  return {
    bucketTokens,
    windowTokens: span * bucketTokens,
    contextTokens: series.contextTokens,
    buckets,
  };
}
