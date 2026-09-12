import type {
  PackedSession,
  PackedSessionPart,
  PackedUsage,
} from './packed-session.ts';

/** Output streaming rate: the clock advances one token per tick. */
export const PLAYBACK_TOKENS_PER_SECOND = 50;
/**
 * Input (prefill) processing rate, in tokens per second. Applied to a
 * request's uncached input tokens (`input - cacheRead`) before its output
 * starts streaming, bounded by {@link MAX_INPUT_PROCESSING_MS}.
 */
export const INPUT_PROCESSING_TOKENS_PER_SECOND = 500;
/** Upper bound on the first request's input (prefill) processing time. */
export const MAX_INPUT_PROCESSING_MS = 2000;
/** Wall-clock pause inserted after each streamed tool call while the agent runs it. */
export const TOOL_EXECUTION_MS = 300;
/**
 * Minimum pause between one request settling (stream finished, tools done)
 * and the next request appearing, so jumping to a completed request never
 * reveals the following one.
 */
export const REQUEST_GAP_MS = 10;
/** Pause before the user starts typing a prompt. */
export const USER_TYPING_DELAY_MS = 2000;
/** Average typing speed for user prompts, in words per minute. */
export const USER_TYPING_WORDS_PER_MINUTE = 45;
/** Assumed characters per word when converting the typing speed. */
const TYPING_CHARACTERS_PER_WORD = 5;

const textEncoder = new TextEncoder();

/** Exact UTF-8 byte length of a value's JSON serialization. */
function utf8JsonBytes(value: unknown): number {
  return textEncoder.encode(JSON.stringify(value)).length;
}

/** Typing duration for a prompt of `characterCount`, in milliseconds. */
function typingDurationMs(characterCount: number): number {
  const charactersPerSecond =
    (USER_TYPING_WORDS_PER_MINUTE * TYPING_CHARACTERS_PER_WORD) / 60;
  return Math.round((characterCount / charactersPerSecond) * 1000);
}

/**
 * A renderable transcript entry. Streaming entries (`user`, `thinking`,
 * `text`, `toolCall`) reveal content character-by-character between the
 * `start` and `end` times; instant entries (`toolResult`) appear entirely at
 * `appearAt`. All positions are seconds on the playback timeline.
 */
export type TimelineEntry =
  | {
      kind: 'user';
      id: string;
      text: string;
      /** Typing window: the prompt is revealed character-by-character. */
      start: number;
      end: number;
    }
  | {
      kind: 'thinking';
      id: string;
      requestId: string;
      text: string;
      start: number;
      end: number;
    }
  | {
      kind: 'text';
      id: string;
      requestId: string;
      text: string;
      start: number;
      end: number;
    }
  | {
      kind: 'toolCall';
      id: string;
      requestId: string;
      callId: string;
      name: string;
      /** Short human label, e.g. the command for `bash` or the path for `read`. */
      summary: string;
      /** Full pretty-printed arguments. */
      argsText: string;
      start: number;
      end: number;
    }
  | {
      kind: 'toolResult';
      id: string;
      callId: string;
      toolName: string;
      isError: boolean;
      text: string;
      appearAt: number;
    };

export type RequestTimeline = {
  id: string;
  /** 1-based display index. */
  index: number;
  provider: string;
  model: string;
  /** When the request was sent; it shows as processing from here. */
  sentTime: number;
  /** When input processing finished and output starts streaming. */
  streamStartTime: number;
  /** When the response finished streaming. */
  endTime: number;
  usage: PackedUsage;
  stopReason: string | undefined;
  toolCallCount: number;
  /** UTF-8 JSON byte length of the request prompt. */
  sentBytes: number;
  /** UTF-8 JSON byte length of the parsed response. */
  receivedBytes: number;
};

export type Timeline = {
  entries: TimelineEntry[];
  requests: RequestTimeline[];
  /** Sum of every request's output tokens. */
  totalTokens: number;
  /** End of the playback timeline, in seconds. */
  durationSeconds: number;
  systemPrompt: string | undefined;
  cwd: string | undefined;
  model: string;
  provider: string;
  tools: readonly string[];
};

export type EntryState = {
  entry: TimelineEntry;
  /** Characters revealed so far; equals `text.length` once complete. */
  revealed: number;
  streaming: boolean;
};

export type RequestState = {
  request: RequestTimeline;
  status: 'processing' | 'streaming' | 'done';
};

/** UTF-8 byte length of a string. */
function utf8Length(value: string): number {
  return textEncoder.encode(value).length;
}

/** Content weight of a response block: the bytes it carries on screen. */
function blockWeightBytes(block: PackedSessionPart): number {
  if (block.type === 'thinking') return utf8Length(block.thinking);
  if (block.type === 'text') return utf8Length(block.text);
  return utf8JsonBytes({ name: block.name, arguments: block.arguments });
}

/**
 * Splits a request's streaming window across its response content blocks,
 * proportional to each block's UTF-8 byte length, falling back to an even
 * split when every block is empty. Recorded segment durations are ignored:
 * they include API latency, which does not represent generation speed.
 * Works in integer milliseconds; returns half-open windows aligned with
 * `content` indices.
 */
function allocateBlockWindowsMs(
  startMs: number,
  windowMs: number,
  content: readonly PackedSessionPart[],
): Array<{ start: number; end: number }> {
  const rawWeights = content.map(blockWeightBytes);
  const weights = rawWeights.some((weight) => weight > 0)
    ? rawWeights
    : rawWeights.map(() => 1);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const ranges: Array<{ start: number; end: number }> = [];
  let elapsed = 0;
  for (const weight of weights) {
    elapsed += weight;
    ranges.push({
      start: 0,
      end: startMs + (windowMs * elapsed) / totalWeight,
    });
  }
  let previousBoundary = startMs;
  for (const range of ranges) {
    range.start = previousBoundary;
    previousBoundary = range.end;
  }
  return ranges;
}

function toolCallSummary(
  name: string,
  args: Record<string, unknown>,
): { summary: string; argsText: string } {
  const command = args.command;
  if (typeof command === 'string') {
    return { summary: command, argsText: command };
  }
  const path = args.path;
  const argsText = JSON.stringify(args, null, 2);
  if (typeof path === 'string') {
    return { summary: path, argsText };
  }
  const firstString = Object.values(args).find(
    (value) => typeof value === 'string',
  );
  return {
    summary: typeof firstString === 'string' ? firstString : name,
    argsText,
  };
}

function toolResultText(parts: readonly { type: string; text?: string }[]) {
  return parts
    .map((part) => (part.type === 'text' ? (part.text ?? '') : ''))
    .join('\n')
    .trim();
}

/**
 * Reconstructs the playback timeline from a packed session. Each turn
 * occupies a sequence of wall-clock phases:
 *
 * 1. `typing` — user prompts newly included in the request pause for
 *    `USER_TYPING_DELAY_MS`, then type out at an average speed; the request
 *    is sent once typing finishes. The first prompt is the exception: the
 *    session opens with it already written.
 * 2. `input processing` — the request's uncached input tokens process at
 *    `INPUT_PROCESSING_TOKENS_PER_SECOND`; the first request is bounded by
 *    `MAX_INPUT_PROCESSING_MS`.
 * 3. `streaming` — output tokens stream at `PLAYBACK_TOKENS_PER_SECOND`,
 *    spread across the response content blocks proportionally to each
 *    block's UTF-8 byte length.
 * 4. `tools` — `TOOL_EXECUTION_MS` per streamed tool call; tool results
 *    appear when the phase ends.
 *
 * A small gap separates one request from the next. Request and response
 * payload sizes (UTF-8 JSON byte lengths) are computed once per request.
 */
export function buildTimeline(session: PackedSession): Timeline {
  const resultsByCallId = new Map<
    string,
    { text: string; isError: boolean; toolName: string }
  >();
  for (const message of session.prompt.messages) {
    if (message.role !== 'toolResult' || message.toolCallId === undefined) {
      continue;
    }
    resultsByCallId.set(message.toolCallId, {
      text: toolResultText(message.parts),
      isError: message.isError === true,
      toolName: message.toolName ?? 'tool',
    });
  }

  const entries: TimelineEntry[] = [];
  const requests: RequestTimeline[] = [];
  // Phases are accumulated in integer milliseconds so that positions stay
  // exact; the public timeline exposes seconds.
  let requestTimeMs = 0;
  let totalTokens = 0;
  let durationSeconds = 0;
  let previousMessageCount = 0;

  session.requests.forEach((request, requestIndex) => {
    const usage = request.data.response.usage;
    const response = request.response;

    // New user prompts are typed: a pause, then characters at an average
    // typing speed. The request is sent once typing finishes. The first
    // prompt is the exception — the session opens with it already written.
    let sentTimeMs = requestTimeMs;
    const newUserMessages = session.prompt.messages
      .slice(previousMessageCount, request.messageCount)
      .filter(
        (message) =>
          message.role === 'user' && toolResultText(message.parts).length > 0,
      );
    for (const message of newUserMessages) {
      const text = toolResultText(message.parts);
      const id = `user-${message.index}`;
      if (requestIndex === 0) {
        entries.push({
          kind: 'user',
          id,
          text,
          start: sentTimeMs / 1000,
          end: sentTimeMs / 1000,
        });
        continue;
      }
      const typingStartMs = sentTimeMs + USER_TYPING_DELAY_MS;
      const typingEndMs = typingStartMs + typingDurationMs(text.length);
      entries.push({
        kind: 'user',
        id,
        text,
        start: typingStartMs / 1000,
        end: typingEndMs / 1000,
      });
      sentTimeMs = typingEndMs;
    }

    const uncachedInput = Math.max(0, usage.input - usage.cacheRead);
    const rawInputProcessingMs = Math.round(
      (uncachedInput / INPUT_PROCESSING_TOKENS_PER_SECOND) * 1000,
    );
    const streamStartTimeMs =
      sentTimeMs +
      (requestIndex === 0
        ? Math.min(rawInputProcessingMs, MAX_INPUT_PROCESSING_MS)
        : rawInputProcessingMs);
    const streamMs = Math.round(
      (usage.output / PLAYBACK_TOKENS_PER_SECOND) * 1000,
    );
    const endTimeMs = streamStartTimeMs + streamMs;
    const toolCallCount =
      response?.content.filter((block) => block.type === 'toolCall').length ??
      0;
    const toolPhaseMs = toolCallCount * TOOL_EXECUTION_MS;
    const settledTimeMs = endTimeMs + toolPhaseMs;

    requests.push({
      id: request.id,
      index: requestIndex + 1,
      provider: request.data.request.provider,
      model: request.data.request.model,
      sentTime: sentTimeMs / 1000,
      streamStartTime: streamStartTimeMs / 1000,
      endTime: endTimeMs / 1000,
      usage,
      stopReason: request.data.response.stopReason,
      toolCallCount,
      sentBytes: utf8JsonBytes({
        system: session.prompt.system,
        tools: session.prompt.tools,
        messages: session.prompt.messages.slice(0, request.messageCount),
      }),
      receivedBytes: response ? utf8JsonBytes(response) : 0,
    });
    totalTokens += usage.output;
    previousMessageCount = request.messageCount;

    if (response && response.content.length > 0) {
      const windowsMs = allocateBlockWindowsMs(
        streamStartTimeMs,
        streamMs,
        response.content,
      );
      response.content.forEach((block, blockIndex) => {
        const { start, end } = {
          start: windowsMs[blockIndex].start / 1000,
          end: windowsMs[blockIndex].end / 1000,
        };
        if (block.type === 'thinking') {
          entries.push({
            kind: 'thinking',
            id: `${request.id}-thinking-${blockIndex}`,
            requestId: request.id,
            text: block.thinking,
            start,
            end,
          });
        } else if (block.type === 'text') {
          entries.push({
            kind: 'text',
            id: `${request.id}-text-${blockIndex}`,
            requestId: request.id,
            text: block.text,
            start,
            end,
          });
        } else {
          const { summary, argsText } = toolCallSummary(
            block.name,
            block.arguments,
          );
          entries.push({
            kind: 'toolCall',
            id: `${request.id}-tool-${blockIndex}`,
            requestId: request.id,
            callId: block.id,
            name: block.name,
            summary,
            argsText,
            start,
            end,
          });
        }
      });
    }

    // Tool results become visible once their tool execution phase ends.
    for (const block of response?.content ?? []) {
      if (block.type !== 'toolCall') continue;
      const result = resultsByCallId.get(block.id);
      if (!result) continue;
      entries.push({
        kind: 'toolResult',
        id: `${request.id}-result-${block.id}`,
        callId: block.id,
        toolName: result.toolName,
        isError: result.isError,
        text: result.text,
        appearAt: settledTimeMs / 1000,
      });
    }

    durationSeconds = settledTimeMs / 1000;
    requestTimeMs = settledTimeMs + REQUEST_GAP_MS;
  });

  const firstRequest = session.requests[0];
  return {
    entries,
    requests,
    totalTokens,
    durationSeconds,
    systemPrompt: session.prompt.system,
    cwd: session.session.cwd,
    model: firstRequest?.data.request.model ?? 'unknown',
    provider: firstRequest?.data.request.provider ?? 'unknown',
    tools: (session.prompt.tools ?? []).map((tool) => tool.name),
  };
}

export function playbackDurationSeconds(timeline: Timeline): number {
  return timeline.durationSeconds;
}

/** Snapshot of the transcript at a playback time, for rendering. */
export function entriesAt(
  timeline: Timeline,
  timeSeconds: number,
): EntryState[] {
  const states: EntryState[] = [];
  for (const entry of timeline.entries) {
    if (entry.kind === 'toolResult') {
      if (timeSeconds < entry.appearAt) continue;
      states.push({ entry, revealed: entry.text.length, streaming: false });
      continue;
    }
    if (timeSeconds < entry.start) continue;
    const length = entry.kind === 'toolCall' ? 1 : entry.text.length;
    const streaming = timeSeconds < entry.end;
    const revealed =
      entry.end <= entry.start || !streaming
        ? length
        : Math.min(
            length,
            Math.floor(
              ((timeSeconds - entry.start) / (entry.end - entry.start)) *
                length,
            ),
          );
    states.push({ entry, revealed, streaming });
  }
  return states;
}

/** Snapshot of the provider request list at a playback time. */
export function requestsAt(
  timeline: Timeline,
  timeSeconds: number,
): RequestState[] {
  const states: RequestState[] = [];
  for (const request of timeline.requests) {
    if (timeSeconds < request.sentTime) continue;
    states.push({
      request,
      status:
        timeSeconds < request.streamStartTime
          ? 'processing'
          : timeSeconds < request.endTime
            ? 'streaming'
            : 'done',
    });
  }
  return states;
}

export type UsageCategory = { tokens: number; cost: number };

export type UsageBreakdown = {
  cached: UsageCategory;
  cacheWrite: UsageCategory;
  input: UsageCategory;
  output: UsageCategory;
  total: UsageCategory;
};

/** Per-category token and cost totals over the completed requests. */
export function usageBreakdownAt(
  timeline: Timeline,
  timeSeconds: number,
): UsageBreakdown {
  const empty = (): UsageCategory => ({ tokens: 0, cost: 0 });
  const breakdown: UsageBreakdown = {
    cached: empty(),
    cacheWrite: empty(),
    input: empty(),
    output: empty(),
    total: empty(),
  };
  for (const request of timeline.requests) {
    if (timeSeconds < request.endTime) continue;
    const usage = request.usage;
    const cost = usage.cost;
    breakdown.cached.tokens += usage.cacheRead;
    breakdown.cached.cost += cost?.cacheRead ?? 0;
    breakdown.cacheWrite.tokens += usage.cacheWrite;
    breakdown.cacheWrite.cost += cost?.cacheWrite ?? 0;
    breakdown.input.tokens += usage.input;
    breakdown.input.cost += cost?.input ?? 0;
    breakdown.output.tokens += usage.output;
    breakdown.output.cost += cost?.output ?? 0;
    breakdown.total.tokens +=
      usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    breakdown.total.cost += cost?.total ?? 0;
  }
  return breakdown;
}
