import type { PackedSession, PackedUsage } from './packed-session.ts';

/** Playback speed: timeline tokens are virtual output tokens. */
export const PLAYBACK_TOKENS_PER_SECOND = 50;

/**
 * A renderable transcript entry. Streaming entries (`thinking`, `text`,
 * `toolCall`) reveal content character-by-character between the `start` and
 * `end` token positions; instant entries (`user`, `toolResult`) appear
 * entirely at `appearAt`.
 */
export type TimelineEntry =
  | {
      kind: 'user';
      id: string;
      text: string;
      appearAt: number;
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
  /** Token position when the request was sent. */
  start: number;
  /** Token position when the response finished streaming. */
  end: number;
  usage: PackedUsage;
  stopReason: string | undefined;
};

export type Timeline = {
  entries: TimelineEntry[];
  requests: RequestTimeline[];
  /** Sum of every request's output tokens; the end of the timeline. */
  totalTokens: number;
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
  status: 'streaming' | 'done';
};

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
 * Allocates a request's output tokens across its response content blocks,
 * proportional to each block's real streaming duration when segments are
 * available. Returns half-open token ranges aligned with `content` indices.
 */
function allocateBlockTokens(
  blockCount: number,
  tokenBudget: number,
  segments:
    | readonly { contentIndex: number; startDtMs: number; endDtMs: number }[]
    | undefined,
  startIndex: number,
): Array<{ start: number; end: number }> {
  const rawWeights: number[] = Array.from(
    { length: blockCount },
    (_, index) => {
      const segment = segments?.find(
        (candidate) => candidate.contentIndex === index,
      );
      const duration =
        segment === undefined
          ? 0
          : Math.max(0, segment.endDtMs - segment.startDtMs);
      return Number.isFinite(duration) ? duration : 0;
    },
  );
  const weights = rawWeights.some((weight) => weight > 0)
    ? rawWeights
    : rawWeights.map(() => 1);
  const totalDuration = weights.reduce((sum, weight) => sum + weight, 0);
  const ranges: Array<{ start: number; end: number }> = [];
  let elapsed = 0;
  for (const weight of weights) {
    elapsed += weight;
    const boundary = startIndex + (tokenBudget * elapsed) / totalDuration;
    ranges.push({ start: 0, end: Math.round(boundary) });
  }
  let previousBoundary = startIndex;
  for (const range of ranges) {
    range.start = previousBoundary;
    previousBoundary = range.end;
  }
  return ranges;
}

/**
 * Reconstructs the playback timeline from a packed session: a flat transcript
 * of entries with token positions, plus the per-request timeline. Requests
 * occupy contiguous token ranges sized by their output token counts; tool
 * results appear the moment their request completes.
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
  let tokens = 0;
  let previousMessageCount = 0;

  session.requests.forEach((request, requestIndex) => {
    const requestStart = tokens;
    const outputTokens = request.data.response.usage.output;
    const requestEnd = requestStart + outputTokens;
    requests.push({
      id: request.id,
      index: requestIndex + 1,
      provider: request.data.request.provider,
      model: request.data.request.model,
      start: requestStart,
      end: requestEnd,
      usage: request.data.response.usage,
      stopReason: request.data.response.stopReason,
    });

    // User turns included in this request for the first time become visible
    // when the request is sent.
    for (const message of session.prompt.messages.slice(
      previousMessageCount,
      request.messageCount,
    )) {
      if (message.role !== 'user') continue;
      const text = toolResultText(message.parts);
      if (text.length === 0) continue;
      entries.push({
        kind: 'user',
        id: `user-${message.index}`,
        text,
        appearAt: requestStart,
      });
    }
    previousMessageCount = request.messageCount;

    const response = request.response;
    if (!response || response.content.length === 0) {
      tokens = requestEnd;
      return;
    }
    const ranges = allocateBlockTokens(
      response.content.length,
      outputTokens,
      request.data.timing.segments,
      requestStart,
    );
    response.content.forEach((block, blockIndex) => {
      const { start, end } = ranges[blockIndex];
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

    // Tool results become visible the moment the response finished streaming.
    for (const block of response.content) {
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
        appearAt: requestEnd,
      });
    }
    tokens = requestEnd;
  });

  const firstRequest = session.requests[0];
  return {
    entries,
    requests,
    totalTokens: tokens,
    systemPrompt: session.prompt.system,
    cwd: session.session.cwd,
    model: firstRequest?.data.request.model ?? 'unknown',
    provider: firstRequest?.data.request.provider ?? 'unknown',
    tools: (session.prompt.tools ?? []).map((tool) => tool.name),
  };
}

export function playbackDurationSeconds(timeline: Timeline): number {
  return timeline.totalTokens / PLAYBACK_TOKENS_PER_SECOND;
}

export function tokensAt(timeSeconds: number): number {
  return timeSeconds * PLAYBACK_TOKENS_PER_SECOND;
}

/** Inverse of {@link tokensAt}. */
export function timeAtTokens(tokens: number): number {
  return tokens / PLAYBACK_TOKENS_PER_SECOND;
}

/** Snapshot of the transcript at a token position, for rendering. */
export function entriesAt(timeline: Timeline, tokens: number): EntryState[] {
  const states: EntryState[] = [];
  for (const entry of timeline.entries) {
    if (entry.kind === 'user' || entry.kind === 'toolResult') {
      if (tokens < entry.appearAt) continue;
      states.push({
        entry,
        revealed: entry.text.length,
        streaming: false,
      });
      continue;
    }
    if (tokens < entry.start) continue;
    const length = entry.kind === 'toolCall' ? 1 : entry.text.length;
    const streaming = tokens < entry.end;
    const revealed =
      entry.end <= entry.start || !streaming
        ? length
        : Math.min(
            length,
            Math.floor(
              ((tokens - entry.start) / (entry.end - entry.start)) * length,
            ),
          );
    states.push({ entry, revealed, streaming });
  }
  return states;
}

/** Snapshot of the provider request list at a token position. */
export function requestsAt(timeline: Timeline, tokens: number): RequestState[] {
  const states: RequestState[] = [];
  for (const request of timeline.requests) {
    if (tokens < request.start) continue;
    states.push({
      request,
      status: tokens < request.end ? 'streaming' : 'done',
    });
  }
  return states;
}

/** Usage totals over the requests completed at a token position. */
export function usageTotalsAt(
  timeline: Timeline,
  tokens: number,
): { input: number; output: number; cost: number } {
  let input = 0;
  let output = 0;
  let cost = 0;
  for (const request of timeline.requests) {
    if (tokens < request.end) continue;
    input += request.usage.input;
    output += request.usage.output;
    cost += request.usage.cost?.total ?? 0;
  }
  return { input, output, cost };
}
