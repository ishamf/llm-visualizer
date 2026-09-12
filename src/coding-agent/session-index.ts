export const SESSION_INDEX_SCHEMA_VERSION = 1 as const;

/** Hand-written metadata, one per session folder (`info.json`). */
export type SessionInfo = {
  title: string;
  description?: string;
};

/**
 * One session in the generated catalog. Playback statistics are derived
 * from the packed session when the index is compiled, so the selector can
 * show them without downloading every session.
 */
export type SessionIndexEntry = {
  /** Folder name; also the public identifier used in the URL. */
  id: string;
  /** Folder path relative to the catalog root, ends with `/`. */
  path: string;
  info: SessionInfo;
  model: string;
  provider: string;
  requestCount: number;
  outputTokens: number;
  totalCost: number;
  /** Playback duration in seconds. */
  durationSeconds: number;
};

export type SessionIndex = {
  schemaVersion: typeof SESSION_INDEX_SCHEMA_VERSION;
  sessions: SessionIndexEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseSessionInfo(value: unknown): SessionInfo {
  if (
    !isRecord(value) ||
    typeof value.title !== 'string' ||
    value.title.length === 0 ||
    (value.description !== undefined && typeof value.description !== 'string')
  ) {
    throw new Error(
      'Session info must be an object with a non-empty title and an optional description',
    );
  }
  return {
    title: value.title,
    description: value.description as string | undefined,
  };
}

function parseNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Session index entry has an invalid ${label}`);
  }
  return value;
}

function parseSessionIndexEntry(
  value: unknown,
  index: number,
): SessionIndexEntry {
  const label = `Session index entry ${index}`;
  if (!isRecord(value)) throw new Error(`${label} is invalid`);
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    value.id.startsWith('/') ||
    value.id.includes('..')
  ) {
    throw new Error(`${label} has an invalid id`);
  }
  if (
    typeof value.path !== 'string' ||
    value.path.length === 0 ||
    value.path.startsWith('/') ||
    value.path.includes('..') ||
    !value.path.endsWith('/')
  ) {
    throw new Error(`${label} has an invalid path`);
  }
  if (typeof value.model !== 'string' || value.model.length === 0) {
    throw new Error(`${label} has an invalid model`);
  }
  if (typeof value.provider !== 'string' || value.provider.length === 0) {
    throw new Error(`${label} has an invalid provider`);
  }
  let info: SessionInfo;
  try {
    info = parseSessionInfo(value.info);
  } catch {
    throw new Error(`${label} has an invalid info object`);
  }
  return {
    id: value.id,
    path: value.path,
    info,
    model: value.model,
    provider: value.provider,
    requestCount: parseNonNegativeNumber(value.requestCount, 'requestCount'),
    outputTokens: parseNonNegativeNumber(value.outputTokens, 'outputTokens'),
    totalCost: parseNonNegativeNumber(value.totalCost, 'totalCost'),
    durationSeconds: parseNonNegativeNumber(
      value.durationSeconds,
      'durationSeconds',
    ),
  };
}

export function parseSessionIndex(value: unknown): SessionIndex {
  if (
    !isRecord(value) ||
    value.schemaVersion !== SESSION_INDEX_SCHEMA_VERSION ||
    !Array.isArray(value.sessions)
  ) {
    throw new Error('Session index has an unsupported shape');
  }
  return {
    schemaVersion: SESSION_INDEX_SCHEMA_VERSION,
    sessions: value.sessions.map(parseSessionIndexEntry),
  };
}
