import { describe, expect, it } from 'vitest';

import {
  buildTimeline,
  entriesAt,
  playbackDurationSeconds,
  requestsAt,
  usageTotalsAt,
} from './timeline.ts';
import {
  TEST_ASSISTANT_TEXT,
  TEST_SECOND_USER_TEXT,
  TEST_THINKING_TEXT,
  TEST_TOOL_RESULT_TEXT,
  TEST_USER_TEXT,
  makeTestSession,
} from './test-fixtures.ts';

/**
 * Fixture timeline, derived from the fixture constants:
 *
 * - Request 1: sent 0s, prefill (10 − 5 cached) / 500 tps = 0.01s, streams
 *   100 output tokens / 50 tps = 2s → ends 2.01s; 1 tool call → settles at
 *   2.31s.
 * - Request 2: sent 2.32s (10ms gap), prefill 20 / 500 = 0.04s, streams 50
 *   tokens / 50 tps = 1s → ends 3.36s; no tools → timeline ends 3.36s.
 */
describe('buildTimeline', () => {
  it('places requests in sequential processing/streaming/tool phases', () => {
    const timeline = buildTimeline(makeTestSession());
    expect(timeline.totalTokens).toBe(150);
    expect(timeline.requests[0]).toMatchObject({
      id: '0001',
      sentTime: 0,
      streamStartTime: 0.01,
      endTime: 2.01,
      toolCallCount: 1,
    });
    expect(timeline.requests[1]).toMatchObject({
      id: '0002',
      sentTime: 2.32,
      streamStartTime: 2.36,
      endTime: 3.36,
      toolCallCount: 0,
    });
    expect(playbackDurationSeconds(timeline)).toBeCloseTo(3.36);
  });

  it('splits a request’s streaming window across blocks by segment duration', () => {
    const timeline = buildTimeline(makeTestSession());
    // Segments: thinking 50ms, toolCall 200ms → 1:4 split of the 2s window
    // starting at 0.01s.
    const thinking = timeline.entries.find(
      (entry) => entry.kind === 'thinking',
    );
    const toolCall = timeline.entries.find(
      (entry) => entry.kind === 'toolCall',
    );
    expect(thinking).toMatchObject({ start: 0.01, end: 0.41 });
    expect(toolCall).toMatchObject({ start: 0.41, end: 2.01 });
  });

  it('shows user turns when their request is sent and results after tool execution', () => {
    const timeline = buildTimeline(makeTestSession());
    const firstUser = timeline.entries.find(
      (entry) => entry.kind === 'user' && entry.text === TEST_USER_TEXT,
    );
    const secondUser = timeline.entries.find(
      (entry) => entry.kind === 'user' && entry.text === TEST_SECOND_USER_TEXT,
    );
    const toolResult = timeline.entries.find(
      (entry) => entry.kind === 'toolResult',
    );
    expect(firstUser).toMatchObject({ appearAt: 0 });
    expect(secondUser).toMatchObject({ appearAt: 2.32 });
    expect(toolResult).toMatchObject({
      callId: 'call_1',
      appearAt: 2.31,
      text: TEST_TOOL_RESULT_TEXT,
      isError: false,
    });
  });

  it('keeps the session model and provider', () => {
    const timeline = buildTimeline(makeTestSession());
    expect(timeline.model).toBe('test-model');
    expect(timeline.provider).toBe('test-provider');
    expect(timeline.cwd).toBe('/project');
  });
});

describe('entriesAt', () => {
  const timeline = buildTimeline(makeTestSession());

  it('hides future entries', () => {
    // At t=0 only the first user turn is visible; the request is still
    // processing its input.
    const atStart = entriesAt(timeline, 0);
    expect(atStart.map(({ entry }) => entry.kind)).toEqual(['user']);
    expect(atStart[0]).toMatchObject({ revealed: TEST_USER_TEXT.length });
  });

  it('reveals streaming text proportionally', () => {
    // Thinking: 1 char over [0.01, 0.41).
    expect(entriesAt(timeline, 0.2)[1]).toMatchObject({
      revealed: 0,
      streaming: true,
    });
    expect(entriesAt(timeline, 0.41)[1]).toMatchObject({
      revealed: TEST_THINKING_TEXT.length,
      streaming: false,
    });
    // Final text: 8 chars over [2.36, 3.36) → half at 2.86.
    const atHalf = entriesAt(timeline, 2.86);
    const finalText = atHalf.find(({ entry }) => entry.kind === 'text');
    expect(finalText).toMatchObject({
      revealed: Math.floor(TEST_ASSISTANT_TEXT.length / 2),
      streaming: true,
    });
  });

  it('hides tool results until the tool execution phase ends', () => {
    const beforeResults = entriesAt(timeline, 2.2);
    expect(beforeResults.some(({ entry }) => entry.kind === 'toolResult')).toBe(
      false,
    );
    const afterResults = entriesAt(timeline, 2.31);
    expect(afterResults.some(({ entry }) => entry.kind === 'toolResult')).toBe(
      true,
    );
  });

  it('reveals everything at the end of the timeline', () => {
    const states = entriesAt(timeline, 3.36);
    expect(states).toHaveLength(6);
    for (const state of states) {
      expect(state.streaming).toBe(false);
    }
  });
});

describe('requestsAt', () => {
  const timeline = buildTimeline(makeTestSession());

  it('marks the in-flight request as streaming and hides future ones', () => {
    expect(requestsAt(timeline, 1)).toEqual([
      { request: timeline.requests[0], status: 'streaming' },
    ]);
  });

  it('shows input processing before streaming', () => {
    expect(requestsAt(timeline, 0)).toEqual([
      { request: timeline.requests[0], status: 'processing' },
    ]);
    expect(requestsAt(timeline, 2.33)).toEqual([
      { request: timeline.requests[0], status: 'done' },
      { request: timeline.requests[1], status: 'processing' },
    ]);
  });

  it('marks completed requests as done at the boundary', () => {
    expect(requestsAt(timeline, 2.01)).toEqual([
      { request: timeline.requests[0], status: 'done' },
    ]);
    expect(requestsAt(timeline, 3.36)).toEqual([
      { request: timeline.requests[0], status: 'done' },
      { request: timeline.requests[1], status: 'done' },
    ]);
  });
});

describe('usageTotalsAt', () => {
  const timeline = buildTimeline(makeTestSession());

  it('accrues usage only from completed requests', () => {
    expect(usageTotalsAt(timeline, 2)).toEqual({
      input: 0,
      output: 0,
      cost: 0,
    });
    expect(usageTotalsAt(timeline, 2.01)).toEqual({
      input: 10,
      output: 100,
      cost: 0.01,
    });
    expect(usageTotalsAt(timeline, 3.36)).toEqual({
      input: 30,
      output: 150,
      cost: 0.03,
    });
  });
});
