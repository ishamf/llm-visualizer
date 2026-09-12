import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { parsePackedSession } from '../coding-agent/packed-session.ts';
import {
  SESSION_INDEX_SCHEMA_VERSION,
  parseSessionInfo,
  type SessionIndex,
  type SessionIndexEntry,
} from '../coding-agent/session-index.ts';
import { buildTimeline, usageBreakdownAt } from '../coding-agent/timeline.ts';

export const SESSIONS_DIRECTORY = 'coding-agent';

async function directories(root: string) {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function compileSessionEntry(
  sessionRoot: string,
  id: string,
): Promise<SessionIndexEntry> {
  let info: SessionIndexEntry['info'];
  try {
    info = parseSessionInfo(
      JSON.parse(await readFile(path.join(sessionRoot, 'info.json'), 'utf8')),
    );
  } catch (error: unknown) {
    throw new Error(
      `${sessionRoot}/info.json could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }

  const session = parsePackedSession(
    JSON.parse(await readFile(path.join(sessionRoot, 'session.json'), 'utf8')),
  );
  if (session.requests.length === 0) {
    throw new Error(`${sessionRoot}/session.json contains no requests`);
  }
  const timeline = buildTimeline(session);
  const totals = usageBreakdownAt(timeline, Number.POSITIVE_INFINITY);

  return {
    id,
    path: `${id}/`,
    info,
    model: timeline.model,
    provider: timeline.provider,
    requestCount: session.requests.length,
    outputTokens: timeline.totalTokens,
    totalCost: totals.total.cost,
    durationSeconds: timeline.durationSeconds,
  };
}

/**
 * Scans the coding agent sessions root, reading `info.json` + `session.json`
 * from every folder and deriving playback statistics from the timeline.
 */
export async function compileSessionIndex(
  sessionsRoot: string,
): Promise<SessionIndex> {
  const entries: Promise<SessionIndexEntry>[] = [];
  for (const id of await directories(sessionsRoot)) {
    entries.push(compileSessionEntry(path.join(sessionsRoot, id), id));
  }
  const sessions = await Promise.all(entries);
  sessions.sort((left, right) =>
    left.info.title.localeCompare(right.info.title),
  );
  return { schemaVersion: SESSION_INDEX_SCHEMA_VERSION, sessions };
}

export async function writeSessionIndex(generatedRoot: string) {
  const sessionsRoot = path.join(generatedRoot, SESSIONS_DIRECTORY);
  const index = await compileSessionIndex(sessionsRoot);
  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(
    path.join(sessionsRoot, 'index.json'),
    `${JSON.stringify(index, null, 2)}\n`,
  );
  return index;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const generatedRoot = path.resolve(process.argv[2] ?? 'generated');
  const index = await writeSessionIndex(generatedRoot);
  console.log(
    `Wrote a session index with ${index.sessions.length} sessions under ${generatedRoot}/${SESSIONS_DIRECTORY}`,
  );
}
