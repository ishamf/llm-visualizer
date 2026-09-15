import { describe, expect, it } from 'vitest';

import {
  CONTEXT_COST_BUCKET_TOKENS,
  contextCostSeries,
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
