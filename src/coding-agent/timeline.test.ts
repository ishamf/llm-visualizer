import { describe, expect, it } from 'vitest';

import {
  PLAYBACK_TOKENS_PER_SECOND,
  buildTimeline,
  entriesAt,
  playbackDurationSeconds,
  requestsAt,
  timeAtTokens,
  tokensAt,
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

describe('buildTimeline', () => {
  it('allocates contiguous token ranges sized by output tokens', () => {
    const timeline = buildTimeline(makeTestSession());
    expect(timeline.totalTokens).toBe(150);
    expect(timeline.requests[0]).toMatchObject({
      id: '0001',
      start: 0,
      end: 100,
    });
    expect(timeline.requests[1]).toMatchObject({
      id: '0002',
      start: 100,
      end: 150,
    });
    expect(playbackDurationSeconds(timeline)).toBeCloseTo(
      150 / PLAYBACK_TOKENS_PER_SECOND,
    );
  });

  it('converts between seconds and tokens symmetrically', () => {
    expect(timeAtTokens(150)).toBeCloseTo(150 / PLAYBACK_TOKENS_PER_SECOND);
    expect(tokensAt(timeAtTokens(77))).toBeCloseTo(77);
  });

  it('splits a request’s tokens across blocks proportional to segment durations', () => {
    const timeline = buildTimeline(makeTestSession());
    // Segments: thinking 50ms, toolCall 200ms → 1:4 split of 100 tokens.
    const thinking = timeline.entries.find(
      (entry) => entry.kind === 'thinking',
    );
    const toolCall = timeline.entries.find(
      (entry) => entry.kind === 'toolCall',
    );
    expect(thinking).toMatchObject({ start: 0, end: 20 });
    expect(toolCall).toMatchObject({ start: 20, end: 100 });
  });

  it('shows user turns when their request is sent and results when it ends', () => {
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
    expect(secondUser).toMatchObject({ appearAt: 100 });
    expect(toolResult).toMatchObject({
      callId: 'call_1',
      appearAt: 100,
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
    const atStart = entriesAt(timeline, 0);
    expect(atStart.map(({ entry }) => entry.kind)).toEqual([
      'user',
      'thinking',
    ]);
    expect(atStart[0]).toMatchObject({ revealed: TEST_USER_TEXT.length });
  });

  it('reveals streaming text proportionally', () => {
    // Thinking: 1 char over tokens [0, 20) → fully revealed at 20.
    expect(entriesAt(timeline, 10)[1]).toMatchObject({
      revealed: 0,
      streaming: true,
    });
    expect(entriesAt(timeline, 19)[1]).toMatchObject({
      revealed: 0,
      streaming: true,
    });
    expect(entriesAt(timeline, 20)[1]).toMatchObject({
      revealed: TEST_THINKING_TEXT.length,
      streaming: false,
    });
    // Final text: 8 chars over tokens [100, 150) → half at 125.
    const atHalf = entriesAt(timeline, 125);
    const finalText = atHalf.find(({ entry }) => entry.kind === 'text');
    expect(finalText).toMatchObject({
      revealed: Math.floor(TEST_ASSISTANT_TEXT.length / 2),
      streaming: true,
    });
  });

  it('reveals everything at the end of the timeline', () => {
    const states = entriesAt(timeline, 150);
    expect(states).toHaveLength(6);
    for (const state of states) {
      expect(state.streaming).toBe(false);
    }
  });
});

describe('requestsAt', () => {
  const timeline = buildTimeline(makeTestSession());

  it('marks the in-flight request as streaming and hides future ones', () => {
    expect(requestsAt(timeline, 50)).toEqual([
      { request: timeline.requests[0], status: 'streaming' },
    ]);
  });

  it('marks completed requests as done at the boundary', () => {
    expect(requestsAt(timeline, 100)).toEqual([
      { request: timeline.requests[0], status: 'done' },
      { request: timeline.requests[1], status: 'streaming' },
    ]);
    expect(requestsAt(timeline, 150)).toEqual([
      { request: timeline.requests[0], status: 'done' },
      { request: timeline.requests[1], status: 'done' },
    ]);
  });
});

describe('usageTotalsAt', () => {
  const timeline = buildTimeline(makeTestSession());

  it('accrues usage only from completed requests', () => {
    expect(usageTotalsAt(timeline, 99)).toEqual({
      input: 0,
      output: 0,
      cost: 0,
    });
    expect(usageTotalsAt(timeline, 100)).toEqual({
      input: 10,
      output: 100,
      cost: 0.01,
    });
    expect(usageTotalsAt(timeline, 150)).toEqual({
      input: 30,
      output: 150,
      cost: 0.03,
    });
  });
});
