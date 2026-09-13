import { describe, expect, it } from 'vitest';

import {
  INPUT_PROCESSING_TOKENS_PER_SECOND,
  MAX_INPUT_PROCESSING_MS,
  PLAYBACK_TOKENS_PER_SECOND,
  REQUEST_GAP_MS,
  TOOL_EXECUTION_MS,
  USER_TYPING_DELAY_MS,
  USER_TYPING_WORDS_PER_MINUTE,
  buildTimeline,
  entriesAt,
  playbackDurationSeconds,
  requestsAt,
  usageBreakdownAt,
} from './timeline.ts';
import {
  TEST_ASSISTANT_TEXT,
  TEST_SECOND_USER_TEXT,
  TEST_THINKING_TEXT,
  TEST_TOOL_RESULT_TEXT,
  TEST_USER_TEXT,
  makeTestSession,
} from './test-fixtures.ts';

const TYPING_CHARS_PER_SECOND = (USER_TYPING_WORDS_PER_MINUTE * 5) / 60;
const typingMs = (characterCount: number) =>
  Math.round((characterCount / TYPING_CHARS_PER_SECOND) * 1000);
const inputProcessingMs = (uncachedTokens: number) =>
  Math.min(
    Math.round((uncachedTokens / INPUT_PROCESSING_TOKENS_PER_SECOND) * 1000),
    MAX_INPUT_PROCESSING_MS,
  );
const streamMs = (outputTokens: number) =>
  Math.round((outputTokens / PLAYBACK_TOKENS_PER_SECOND) * 1000);

const s = (ms: number) => ms / 1000;

// Fixture timeline: the first prompt appears instantly; request 1 (input 10,
// cached 5, output 100, 1 tool call) then runs its stream + tools, request 2
// (input 20, output 50, no tools) is preceded by the 30-char second prompt
// being typed.
const R1_SENT_MS = 0;
const R1_STREAM_START_MS = R1_SENT_MS + inputProcessingMs(5);
const R1_END_MS = R1_STREAM_START_MS + streamMs(100);
const R1_SETTLED_MS = R1_END_MS + TOOL_EXECUTION_MS;
const R2_TYPING_START_MS =
  R1_SETTLED_MS + REQUEST_GAP_MS + USER_TYPING_DELAY_MS;
const R2_SENT_MS = R2_TYPING_START_MS + typingMs(TEST_SECOND_USER_TEXT.length);
const R2_STREAM_START_MS = R2_SENT_MS + inputProcessingMs(20);
const R2_END_MS = R2_STREAM_START_MS + streamMs(50);

describe('buildTimeline', () => {
  it('places requests in sequential typing/processing/streaming/tool phases', () => {
    const timeline = buildTimeline(makeTestSession());
    expect(timeline.totalTokens).toBe(150);
    expect(timeline.requests[0]).toMatchObject({
      id: '0001',
      sentTime: s(R1_SENT_MS),
      streamStartTime: s(R1_STREAM_START_MS),
      endTime: s(R1_END_MS),
      toolCallCount: 1,
    });
    expect(timeline.requests[1]).toMatchObject({
      id: '0002',
      sentTime: s(R2_SENT_MS),
      streamStartTime: s(R2_STREAM_START_MS),
      endTime: s(R2_END_MS),
      toolCallCount: 0,
    });
    expect(playbackDurationSeconds(timeline)).toBeCloseTo(s(R2_END_MS));
  });

  it('caps input processing for every request, not just the first', () => {
    // A retry after a provider error can lose its cache hit and report the
    // whole prompt as uncached input (e.g. 76k tokens → 153 s unbounded).
    const session = makeTestSession();
    for (const request of session.requests) {
      request.data.response.usage = {
        input: 4000,
        output: request.data.response.usage.output,
        cacheRead: 0,
        cacheWrite: 0,
      };
    }
    const timeline = buildTimeline(session);
    for (const request of timeline.requests) {
      // 4000 uncached tokens would need 8 s at the modeled prefill rate.
      expect(request.streamStartTime - request.sentTime).toBeCloseTo(
        s(MAX_INPUT_PROCESSING_MS),
      );
    }
  });

  it('opens with the first prompt and types later prompts after a delay', () => {
    const timeline = buildTimeline(makeTestSession());
    const firstUser = timeline.entries.find(
      (entry) => entry.kind === 'user' && entry.text === TEST_USER_TEXT,
    );
    const secondUser = timeline.entries.find(
      (entry) => entry.kind === 'user' && entry.text === TEST_SECOND_USER_TEXT,
    );
    // The session opens with the first prompt already written.
    expect(firstUser).toMatchObject({ start: 0, end: 0 });
    expect(secondUser).toMatchObject({
      start: s(R2_TYPING_START_MS),
      end: s(R2_SENT_MS),
    });
  });

  it('splits a request’s streaming window across blocks by content bytes', () => {
    const timeline = buildTimeline(makeTestSession());
    const encoder = new TextEncoder();
    // Weights: 1-byte thinking text vs the tool call's JSON payload
    // (`{ name, arguments }`), regardless of recorded segment durations.
    const thinkingBytes = encoder.encode(TEST_THINKING_TEXT).length;
    const toolCallBytes = encoder.encode(
      JSON.stringify({ name: 'bash', arguments: { command: 'ls' } }),
    ).length;
    const thinkingWindowMs =
      (streamMs(100) * thinkingBytes) / (thinkingBytes + toolCallBytes);
    const thinking = timeline.entries.find(
      (entry) => entry.kind === 'thinking',
    );
    const toolCall = timeline.entries.find(
      (entry) => entry.kind === 'toolCall',
    );
    expect(thinking).toMatchObject({
      start: s(R1_STREAM_START_MS),
      end: s(R1_STREAM_START_MS + thinkingWindowMs),
    });
    expect(toolCall).toMatchObject({
      start: s(R1_STREAM_START_MS + thinkingWindowMs),
      end: s(R1_END_MS),
    });
  });

  it('shows tool results once the tool execution phase ends', () => {
    const timeline = buildTimeline(makeTestSession());
    const toolResult = timeline.entries.find(
      (entry) => entry.kind === 'toolResult',
    );
    expect(toolResult).toMatchObject({
      callId: 'call_1',
      appearAt: s(R1_SETTLED_MS),
      text: TEST_TOOL_RESULT_TEXT,
      isError: false,
    });
  });

  it('measures UTF-8 JSON payload sizes once per request', () => {
    const session = makeTestSession();
    const timeline = buildTimeline(session);
    const encoder = new TextEncoder();
    const expectedSent = (messageCount: number) =>
      encoder.encode(
        JSON.stringify({
          system: session.prompt.system,
          tools: session.prompt.tools,
          messages: session.prompt.messages.slice(0, messageCount),
        }),
      ).length;
    expect(timeline.requests[0].sentBytes).toBe(expectedSent(1));
    expect(timeline.requests[1].sentBytes).toBe(expectedSent(4));
    // Append-only prompts never shrink.
    expect(timeline.requests[1].sentBytes).toBeGreaterThanOrEqual(
      timeline.requests[0].sentBytes,
    );
    expect(timeline.requests[0].receivedBytes).toBe(
      encoder.encode(JSON.stringify(session.requests[0].response)).length,
    );
    expect(timeline.requests[0].receivedBytes).toBeGreaterThan(0);
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

  it('shows the first prompt immediately and types later prompts progressively', () => {
    const timeline = buildTimeline(makeTestSession());
    // First prompt: fully visible from the start, no typing.
    const atStart = entriesAt(timeline, 0);
    expect(atStart).toHaveLength(1);
    expect(atStart[0].entry.kind).toBe('user');
    expect(atStart[0]).toMatchObject({
      revealed: TEST_USER_TEXT.length,
      streaming: false,
    });
    // Second prompt types progressively, finishing when its request is sent.
    const midTyping = entriesAt(
      timeline,
      (R2_TYPING_START_MS + R2_SENT_MS) / 2000,
    );
    const typingState = midTyping.find(
      ({ entry }) =>
        entry.kind === 'user' && entry.text === TEST_SECOND_USER_TEXT,
    );
    expect(typingState).toMatchObject({ streaming: true });
    expect(typingState?.revealed ?? 0).toBeGreaterThanOrEqual(1);
    expect(typingState?.revealed ?? 0).toBeLessThan(
      TEST_SECOND_USER_TEXT.length,
    );
    const done = entriesAt(timeline, s(R2_SENT_MS));
    expect(
      done.find(
        ({ entry }) =>
          entry.kind === 'user' && entry.text === TEST_SECOND_USER_TEXT,
      ),
    ).toMatchObject({
      revealed: TEST_SECOND_USER_TEXT.length,
      streaming: false,
    });
  });

  it('reveals streamed text proportionally', () => {
    // Thinking: 1 char over its window.
    const thinking = timeline.entries.find(
      (entry) => entry.kind === 'thinking',
    );
    if (!thinking || thinking.kind !== 'thinking') throw new Error('missing');
    const midThinking = entriesAt(
      timeline,
      (thinking.start + thinking.end) / 2,
    );
    expect(
      midThinking.find(({ entry }) => entry.kind === 'thinking'),
    ).toMatchObject({ revealed: 0, streaming: true });
    expect(
      entriesAt(timeline, thinking.end).find(
        ({ entry }) => entry.kind === 'thinking',
      ),
    ).toMatchObject({ revealed: TEST_THINKING_TEXT.length, streaming: false });
    // Final text: 8 chars over [streamStart, end] → 90% in reveals 7.
    const finalText = timeline.entries.find((entry) => entry.kind === 'text');
    if (!finalText || finalText.kind !== 'text') throw new Error('missing');
    const at90 = entriesAt(
      timeline,
      finalText.start + (finalText.end - finalText.start) * 0.9,
    );
    expect(at90.find(({ entry }) => entry.kind === 'text')).toMatchObject({
      revealed: Math.floor(TEST_ASSISTANT_TEXT.length * 0.9),
      streaming: true,
    });
  });

  it('hides tool results until the tool execution phase ends', () => {
    const before = entriesAt(timeline, s(R1_SETTLED_MS - 50));
    expect(before.some(({ entry }) => entry.kind === 'toolResult')).toBe(false);
    const after = entriesAt(timeline, s(R1_SETTLED_MS));
    expect(after.some(({ entry }) => entry.kind === 'toolResult')).toBe(true);
  });

  it('reveals everything at the end of the timeline', () => {
    const states = entriesAt(timeline, s(R2_END_MS));
    expect(states).toHaveLength(6);
    for (const state of states) {
      expect(state.streaming).toBe(false);
    }
  });
});

describe('requestsAt', () => {
  const timeline = buildTimeline(makeTestSession());

  it('shows the first request processing input from the start', () => {
    expect(requestsAt(timeline, 0)).toEqual([
      { request: timeline.requests[0], status: 'processing' },
    ]);
  });

  it('marks input processing before streaming', () => {
    expect(requestsAt(timeline, s(R1_SENT_MS + 5))).toEqual([
      { request: timeline.requests[0], status: 'processing' },
    ]);
    expect(requestsAt(timeline, s(R1_STREAM_START_MS + 500))).toEqual([
      { request: timeline.requests[0], status: 'streaming' },
    ]);
    expect(requestsAt(timeline, s(R2_SENT_MS + 5))).toEqual([
      { request: timeline.requests[0], status: 'done' },
      { request: timeline.requests[1], status: 'processing' },
    ]);
  });

  it('omits future requests by default and includes them on request', () => {
    expect(requestsAt(timeline, s(R1_END_MS))).toEqual([
      { request: timeline.requests[0], status: 'done' },
    ]);
    expect(requestsAt(timeline, s(R1_END_MS), { includeFuture: true })).toEqual(
      [
        { request: timeline.requests[0], status: 'done' },
        { request: timeline.requests[1], status: 'future' },
      ],
    );
  });

  it('keeps active statuses when future requests are included', () => {
    expect(requestsAt(timeline, 0, { includeFuture: true })).toEqual([
      { request: timeline.requests[0], status: 'processing' },
      { request: timeline.requests[1], status: 'future' },
    ]);
    expect(
      requestsAt(timeline, s(R2_SENT_MS + 5), { includeFuture: true }),
    ).toEqual([
      { request: timeline.requests[0], status: 'done' },
      { request: timeline.requests[1], status: 'processing' },
    ]);
  });

  it('bounds future requests to the given index limit', () => {
    expect(
      requestsAt(timeline, s(R1_END_MS), {
        includeFuture: true,
        futureLimit: 1,
      }),
    ).toEqual([{ request: timeline.requests[0], status: 'done' }]);
    expect(
      requestsAt(timeline, s(R1_END_MS), {
        includeFuture: true,
        futureLimit: 2,
      }),
    ).toEqual([
      { request: timeline.requests[0], status: 'done' },
      { request: timeline.requests[1], status: 'future' },
    ]);
  });

  it('never bounds requests that are already sent', () => {
    expect(
      requestsAt(timeline, s(R2_SENT_MS + 5), {
        includeFuture: true,
        futureLimit: 1,
      }),
    ).toEqual([
      { request: timeline.requests[0], status: 'done' },
      { request: timeline.requests[1], status: 'processing' },
    ]);
  });

  it('marks completed requests as done at the boundary', () => {
    expect(requestsAt(timeline, s(R1_END_MS))).toEqual([
      { request: timeline.requests[0], status: 'done' },
    ]);
    expect(requestsAt(timeline, s(R2_END_MS))).toEqual([
      { request: timeline.requests[0], status: 'done' },
      { request: timeline.requests[1], status: 'done' },
    ]);
  });
});

describe('usageBreakdownAt', () => {
  const timeline = buildTimeline(makeTestSession());

  it('accrues per-category usage only from completed requests', () => {
    expect(usageBreakdownAt(timeline, s(R1_END_MS - 50))).toEqual({
      cached: { tokens: 0, cost: 0 },
      cacheWrite: { tokens: 0, cost: 0 },
      input: { tokens: 0, cost: 0 },
      output: { tokens: 0, cost: 0 },
      total: { tokens: 0, cost: 0 },
    });
    expect(usageBreakdownAt(timeline, s(R1_END_MS))).toEqual({
      cached: { tokens: 5, cost: 0.001 },
      cacheWrite: { tokens: 0, cost: 0 },
      input: { tokens: 10, cost: 0.006 },
      output: { tokens: 100, cost: 0.003 },
      total: { tokens: 115, cost: 0.01 },
    });
    const breakdown = usageBreakdownAt(timeline, s(R2_END_MS));
    expect(breakdown.cached.tokens).toBe(5);
    expect(breakdown.cached.cost).toBeCloseTo(0.001, 12);
    expect(breakdown.cacheWrite.tokens).toBe(0);
    expect(breakdown.cacheWrite.cost).toBe(0);
    expect(breakdown.input.tokens).toBe(30);
    expect(breakdown.input.cost).toBeCloseTo(0.018, 12);
    expect(breakdown.output.tokens).toBe(150);
    expect(breakdown.output.cost).toBeCloseTo(0.011, 12);
    expect(breakdown.total.tokens).toBe(185);
    expect(breakdown.total.cost).toBeCloseTo(0.03, 12);
  });
});
