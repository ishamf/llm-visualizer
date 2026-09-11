/**
 * Types and parser for the pi-recorder packed session format
 * (`pi-recorder-packed-session`, schemaVersion 1).
 *
 * The packed format stores the final prompt (a superset of every earlier
 * request's prompt), per-request `messageCount` prefix lengths, and the parsed
 * assistant response per request. See
 * pi-visualization-recorder/docs/extension.md §17 for the full specification.
 */

export type PackedSessionPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | {
      type: 'toolCall';
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    };

export type PackedSessionMessage = {
  index: number;
  role: 'user' | 'assistant' | 'toolResult';
  parts: PackedSessionPart[];
  /** toolResult messages only */
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
};

export type PackedTool = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

export type PackedUsageCost = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
};

export type PackedUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  totalTokens?: number;
  cost?: PackedUsageCost;
};

export type PackedTimingSegment = {
  type: 'thinking' | 'text' | 'toolCall';
  contentIndex: number;
  startDtMs: number;
  endDtMs: number;
};

export type PackedRequestData = {
  schemaVersion: number;
  id: string;
  kind: 'turn' | 'internal';
  session?: { id?: string; file?: string; cwd?: string };
  request: {
    provider: string;
    model: string;
    api?: string;
    cacheMarkers?: unknown[];
  };
  response: {
    status?: number;
    usage: PackedUsage;
    stopReason?: string;
    responseId?: string;
    responseModel?: string;
  };
  timing: {
    sentAt: number;
    responseAt?: number;
    endAt?: number;
    ttfbMs?: number;
    streamMs?: number;
    totalMs?: number;
    segments?: PackedTimingSegment[];
  };
};

export type PackedResponse = {
  role: 'assistant';
  content: PackedSessionPart[];
  stopReason?: string;
  usage?: PackedUsage;
  api?: string;
  provider?: string;
  model?: string;
};

export type PackedRequest = {
  id: string;
  kind: 'turn' | 'internal';
  messageCount: number;
  data: PackedRequestData;
  response?: PackedResponse;
};

export type PackedSession = {
  schemaVersion: number;
  format: string;
  recorderVersion?: string;
  packedAt?: string;
  session: { id: string; file?: string; cwd?: string };
  startedAt?: string;
  endedAt?: string;
  prompt: {
    system?: string;
    tools?: PackedTool[];
    messages: PackedSessionMessage[];
  };
  assets?: Record<string, { mimeType: string; bytes: number; data: string }>;
  requests: PackedRequest[];
};

export const PACKED_SESSION_FORMAT = 'pi-recorder-packed-session';
export const PACKED_SESSION_SCHEMA_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function parsePart(value: unknown, context: string): PackedSessionPart {
  if (!isRecord(value)) {
    throw new Error(`${context} is not an object`);
  }
  if (value.type === 'text' && typeof value.text === 'string') {
    return { type: 'text', text: value.text };
  }
  if (value.type === 'thinking' && typeof value.thinking === 'string') {
    return { type: 'thinking', thinking: value.thinking };
  }
  if (
    value.type === 'toolCall' &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isRecord(value.arguments)
  ) {
    return {
      type: 'toolCall',
      id: value.id,
      name: value.name,
      arguments: value.arguments,
    };
  }
  throw new Error(`${context} has an unsupported shape`);
}

function parseParts(value: unknown, context: string): PackedSessionPart[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} is not an array`);
  }
  return value.map((part, partIndex) =>
    parsePart(part, `${context}[${partIndex}]`),
  );
}

function parseMessage(value: unknown, index: number): PackedSessionMessage {
  if (!isRecord(value)) {
    throw new Error(`prompt.messages[${index}] is not an object`);
  }
  const role = value.role;
  if (role !== 'user' && role !== 'assistant' && role !== 'toolResult') {
    throw new Error(`prompt.messages[${index}] has an unsupported role`);
  }
  const message: PackedSessionMessage = {
    index: typeof value.index === 'number' ? value.index : index,
    role,
    parts: parseParts(value.parts, `prompt.messages[${index}].parts`),
  };
  if (role === 'toolResult') {
    message.toolCallId = asString(value.toolCallId);
    message.toolName = asString(value.toolName);
    message.isError = value.isError === true;
    if (message.toolCallId === undefined) {
      throw new Error(`prompt.messages[${index}] is missing toolCallId`);
    }
  }
  return message;
}

function parseUsage(value: unknown, context: string): PackedUsage {
  if (!isRecord(value)) {
    throw new Error(`${context} is missing usage`);
  }
  const costRecord = isRecord(value.cost) ? value.cost : undefined;
  return {
    input: asNonNegativeNumber(value.input),
    output: asNonNegativeNumber(value.output),
    cacheRead: asNonNegativeNumber(value.cacheRead),
    cacheWrite: asNonNegativeNumber(value.cacheWrite),
    reasoning: asNonNegativeNumber(value.reasoning),
    totalTokens: asNonNegativeNumber(value.totalTokens),
    cost: costRecord
      ? {
          input: asNonNegativeNumber(costRecord.input),
          output: asNonNegativeNumber(costRecord.output),
          cacheRead: asNonNegativeNumber(costRecord.cacheRead),
          cacheWrite: asNonNegativeNumber(costRecord.cacheWrite),
          total: asNonNegativeNumber(costRecord.total),
        }
      : undefined,
  };
}

function parseTiming(
  value: unknown,
  context: string,
): PackedRequestData['timing'] {
  if (!isRecord(value) || typeof value.sentAt !== 'number') {
    throw new Error(`${context} is missing timing.sentAt`);
  }
  const segments = Array.isArray(value.segments)
    ? value.segments.filter(
        (segment): segment is PackedTimingSegment =>
          isRecord(segment) &&
          (segment.type === 'thinking' ||
            segment.type === 'text' ||
            segment.type === 'toolCall') &&
          typeof segment.contentIndex === 'number' &&
          typeof segment.startDtMs === 'number' &&
          typeof segment.endDtMs === 'number',
      )
    : undefined;
  return {
    sentAt: value.sentAt,
    responseAt: asNonNegativeNumber(value.responseAt) || undefined,
    endAt: asNonNegativeNumber(value.endAt) || undefined,
    ttfbMs: asNonNegativeNumber(value.ttfbMs) || undefined,
    streamMs: asNonNegativeNumber(value.streamMs) || undefined,
    totalMs: asNonNegativeNumber(value.totalMs) || undefined,
    segments: segments && segments.length > 0 ? segments : undefined,
  };
}

function parseRequest(value: unknown, index: number): PackedRequest {
  if (!isRecord(value)) {
    throw new Error(`requests[${index}] is not an object`);
  }
  if (typeof value.id !== 'string' || typeof value.messageCount !== 'number') {
    throw new Error(`requests[${index}] is missing id or messageCount`);
  }
  const kind = value.kind === 'internal' ? 'internal' : 'turn';
  if (!isRecord(value.data)) {
    throw new Error(`requests[${index}].data is not an object`);
  }
  const data = value.data;
  if (!isRecord(data.request) || typeof data.request.model !== 'string') {
    throw new Error(`requests[${index}].data.request is invalid`);
  }
  const dataResponse = isRecord(data.response) ? data.response : undefined;
  const parsedData: PackedRequestData = {
    schemaVersion:
      typeof data.schemaVersion === 'number' ? data.schemaVersion : 1,
    id: typeof data.id === 'string' ? data.id : value.id,
    kind: data.kind === 'internal' ? 'internal' : kind,
    session: isRecord(data.session)
      ? {
          id: asString(data.session.id),
          file: asString(data.session.file),
          cwd: asString(data.session.cwd),
        }
      : undefined,
    request: {
      provider:
        typeof data.request.provider === 'string'
          ? data.request.provider
          : 'unknown',
      model: data.request.model,
      api: asString(data.request.api),
    },
    response: {
      usage: parseUsage(
        dataResponse?.usage,
        `requests[${index}].data.response`,
      ),
      status:
        typeof dataResponse?.status === 'number'
          ? dataResponse.status
          : undefined,
      stopReason: asString(dataResponse?.stopReason),
      responseId: asString(dataResponse?.responseId),
    },
    timing: parseTiming(data.timing, `requests[${index}].data`),
  };
  const response = isRecord(value.response)
    ? {
        role: 'assistant' as const,
        content: parseParts(
          value.response.content,
          `requests[${index}].response.content`,
        ),
        stopReason: asString(value.response.stopReason),
        usage:
          value.response.usage !== undefined
            ? parseUsage(
                value.response.usage,
                `requests[${index}].response.usage`,
              )
            : undefined,
        api: asString(value.response.api),
        provider: asString(value.response.provider),
        model: asString(value.response.model),
      }
    : undefined;
  return {
    id: value.id,
    kind,
    messageCount: value.messageCount,
    data: parsedData,
    response,
  };
}

/**
 * Parses and validates a packed session document. Throws an `Error`
 * describing the first structural problem found.
 */
export function parsePackedSession(value: unknown): PackedSession {
  if (!isRecord(value)) {
    throw new Error('Session document is not an object');
  }
  if (
    value.schemaVersion !== PACKED_SESSION_SCHEMA_VERSION ||
    value.format !== PACKED_SESSION_FORMAT
  ) {
    throw new Error('Session document has an unsupported format or version');
  }
  if (!isRecord(value.prompt) || !Array.isArray(value.prompt.messages)) {
    throw new Error('Session document is missing prompt.messages');
  }
  if (!Array.isArray(value.requests) || value.requests.length === 0) {
    throw new Error('Session document has no requests');
  }
  const messages = value.prompt.messages.map(parseMessage);
  const requests = value.requests.map(parseRequest);
  let previousMessageCount = 0;
  for (const [index, request] of requests.entries()) {
    if (
      !Number.isInteger(request.messageCount) ||
      request.messageCount < previousMessageCount ||
      request.messageCount > messages.length
    ) {
      throw new Error(
        `requests[${index}] has an out-of-range messageCount (${request.messageCount})`,
      );
    }
    previousMessageCount = request.messageCount;
  }
  const session = isRecord(value.session) ? value.session : undefined;
  const tools = isRecord(value.prompt) ? value.prompt.tools : undefined;
  return {
    schemaVersion: value.schemaVersion,
    format: value.format,
    recorderVersion: asString(value.recorderVersion),
    packedAt: asString(value.packedAt),
    session: {
      id: asString(session?.id) ?? 'unknown',
      file: asString(session?.file),
      cwd: asString(session?.cwd),
    },
    startedAt: asString(value.startedAt),
    endedAt: asString(value.endedAt),
    prompt: {
      system: isRecord(value.prompt)
        ? asString(value.prompt.system)
        : undefined,
      tools: Array.isArray(tools)
        ? tools.filter(
            (tool): tool is PackedTool =>
              isRecord(tool) && typeof tool.name === 'string',
          )
        : undefined,
      messages,
    },
    requests,
  };
}
