import { describe, expect, it } from 'vitest';

import {
  CONTEXT_COST_BUCKET_TOKENS,
  CONTEXT_COST_WINDOW_BUCKET_TOKENS,
  CONTEXT_COST_WINDOW_TOKENS,
  contextCostSeries,
  contextCostWindowSeries,
} from './context-cost.ts';
import type { PackedSession } from './packed-session.ts';
import { makeTestSession } from './test-fixtures.ts';

/** Fixture session with per-request usage replaced. */
function withUsage(
  usages: Array<{
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  }>,
): PackedSession {
  const session = makeTestSession();
  session.requests.forEach((request, index) => {
    const usage = usages[index];
    const cost = {
      input: usage.input * 0.001,
      output: usage.output * 0.01,
      cacheRead: (usage.cacheRead ?? 0) * 0.0001,
      cacheWrite: (usage.cacheWrite ?? 0) * 0.0005,
    };
    request.data.response.usage = {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead ?? 0,
      cacheWrite: usage.cacheWrite ?? 0,
      cost: {
        ...cost,
        total: cost.input + cost.output + cost.cacheRead + cost.cacheWrite,
      },
    };
  });
  return session;
}

const closeTo = (actual: number, expected: number) =>
  expect(actual).toBeCloseTo(expected, 10);

describe('contextCostSeries', () => {
  it('spreads a request’s full cost over its owned context segment', () => {
    // Two buckets: request 1 owns [0, 1100), request 2 owns [1100, 1500).
    const series = contextCostSeries(
      withUsage([
        { input: 400, cacheRead: 500, output: 200 },
        { input: 300, cacheRead: 1100, output: 100 },
      ]),
    );
    expect(series.bucketTokens).toBe(CONTEXT_COST_BUCKET_TOKENS);
    expect(series.contextTokens).toBe(1500);
    expect(series.buckets).toHaveLength(2);
    // Request 1 straddles the boundary: 1000/1100 of its segment in bucket
    // 0, 100/1100 in bucket 1. Request 2 owns [1100, 1500) entirely within
    // bucket 1.
    const r1Total = 0.4 + 2 + 0.05;
    const r2Total = 0.3 + 1 + 0.11;
    closeTo(series.buckets[0].costs.total, (r1Total * 1000) / 1100);
    closeTo(series.buckets[1].costs.total, (r1Total * 100) / 1100 + r2Total);
    closeTo(series.buckets[1].costs.cached, (0.05 * 100) / 1100 + 0.11);
    closeTo(
      series.buckets[0].costs.total + series.buckets[1].costs.total,
      r1Total + (0.3 + 1 + 0.11),
    );
  });

  it('attributes the whole cost when a request adds no new context', () => {
    // Request 2’s prompt + output is smaller than the running context end:
    // it adds no tokens, so its cost lands in the current end’s bucket.
    const series = contextCostSeries(
      withUsage([
        { input: 1000, output: 500 },
        { input: 100, output: 50 },
      ]),
    );
    expect(series.buckets).toHaveLength(2);
    // Request 1 owns [0, 1500): split across both buckets at the boundary.
    const r1Total = 1 + 5;
    closeTo(series.buckets[0].costs.total, (r1Total * 1000) / 1500);
    closeTo(
      series.buckets[1].costs.total,
      (r1Total * 500) / 1500 + (0.1 + 0.5),
    );
  });

  it('handles requests without a cost record', () => {
    const session = withUsage([
      { input: 100, output: 50 },
      { input: 100, output: 50 },
    ]);
    delete session.requests[1].data.response.usage.cost;
    const series = contextCostSeries(session);
    closeTo(
      series.buckets.reduce((sum, bucket) => sum + bucket.costs.total, 0),
      0.1 + 0.5,
    );
  });
});

describe('contextCostWindowSeries', () => {
  it('sums the trailing window of context cost ending at each bucket', () => {
    // One request owning [0, 6000) at 0.001/token: twelve 500-token
    // buckets of 0.5 each. A 5000-token window holds ten buckets, so the
    // first nine buckets sum everything before them (truncated at the
    // session start) and later buckets hold exactly ten buckets' worth.
    const series = contextCostWindowSeries(
      withUsage([
        { input: 6000, output: 0 },
        { input: 0, output: 0 },
      ]),
    );
    expect(series.bucketTokens).toBe(CONTEXT_COST_WINDOW_BUCKET_TOKENS);
    expect(series.windowTokens).toBe(CONTEXT_COST_WINDOW_TOKENS);
    expect(series.contextTokens).toBe(6000);
    expect(series.buckets).toHaveLength(12);
    closeTo(series.buckets[0].costs.total, 0.5);
    closeTo(series.buckets[9].costs.total, 5);
    closeTo(series.buckets[10].costs.total, 5);
    closeTo(series.buckets[11].costs.total, 5);
    // The whole allocation is uncached input cost.
    closeTo(series.buckets[11].costs.input, 5);
    closeTo(
      series.buckets[11].costs.cached +
        series.buckets[11].costs.cacheWrite +
        series.buckets[11].costs.output,
      0,
    );
    // Early windows are truncated at the session start; later ones span
    // exactly 5000 tokens.
    expect(series.buckets[0].windowStart).toBe(0);
    expect(series.buckets[9].windowStart).toBe(0);
    expect(series.buckets[10].windowStart).toBe(500);
    expect(series.buckets[11].windowStart).toBe(1000);
  });

  it('accumulates the trailing window across requests', () => {
    // Request 1 owns [0, 1000) at 0.001/token (input cost 1); request 2
    // owns [1000, 1500) — its 1500 cached-read tokens minus the 1000 the
    // context already covered — at 0.0001/token (cached-read cost 0.15).
    const series = contextCostWindowSeries(
      withUsage([
        { input: 1000, output: 0 },
        { input: 0, cacheRead: 1500, output: 0 },
      ]),
    );
    expect(series.contextTokens).toBe(1500);
    expect(series.buckets).toHaveLength(3);
    closeTo(series.buckets[0].costs.total, 0.5);
    closeTo(series.buckets[2].costs.total, 1.15);
    closeTo(series.buckets[2].costs.input, 1);
    closeTo(series.buckets[2].costs.cached, 0.15);
    expect(series.buckets[2].windowStart).toBe(0);
  });
});
