import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseSessionIndex } from '../coding-agent/session-index.ts';
import { makeTestSession } from '../coding-agent/test-fixtures.ts';
import { buildTimeline, usageBreakdownAt } from '../coding-agent/timeline.ts';
import {
  SESSIONS_DIRECTORY,
  compileSessionIndex,
  writeSessionIndex,
} from './compile-session-index.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function makeGeneratedRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'llm-visualizer-sessions-'));
  temporaryDirectories.push(root);
  return root;
}

async function writeSession(
  sessionsRoot: string,
  id: string,
  info: { title: string; description?: string },
) {
  const directory = path.join(sessionsRoot, id);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(path.join(directory, 'info.json'), JSON.stringify(info)),
    writeFile(
      path.join(directory, 'session.json'),
      JSON.stringify(makeTestSession()),
    ),
  ]);
}

describe('compileSessionIndex', () => {
  it('discovers sessions and derives their statistics', async () => {
    const root = await makeGeneratedRoot();
    const sessionsRoot = path.join(root, SESSIONS_DIRECTORY);
    await writeSession(sessionsRoot, 'session-b', { title: 'Second session' });
    await writeSession(sessionsRoot, 'session-a', {
      title: 'First session',
      description: 'Comes first when sorted',
    });

    const index = await compileSessionIndex(sessionsRoot);
    const session = makeTestSession();
    const timeline = buildTimeline(session);
    const totals = usageBreakdownAt(timeline, Number.POSITIVE_INFINITY);

    expect(index.schemaVersion).toBe(1);
    // Sorted by title, not by folder name.
    expect(index.sessions.map(({ id }) => id)).toEqual([
      'session-a',
      'session-b',
    ]);
    expect(index.sessions[0]).toEqual({
      id: 'session-a',
      path: 'session-a/',
      info: { title: 'First session', description: 'Comes first when sorted' },
      model: timeline.model,
      provider: timeline.provider,
      requestCount: session.requests.length,
      outputTokens: timeline.totalTokens,
      totalCost: totals.total.cost,
      durationSeconds: timeline.durationSeconds,
    });
  });

  it('returns an empty index when the sessions root does not exist', async () => {
    const root = await makeGeneratedRoot();
    const index = await compileSessionIndex(
      path.join(root, SESSIONS_DIRECTORY),
    );
    expect(index.sessions).toEqual([]);
  });

  it('rejects a session with malformed info', async () => {
    const root = await makeGeneratedRoot();
    const sessionsRoot = path.join(root, SESSIONS_DIRECTORY);
    const directory = path.join(sessionsRoot, 'broken');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'info.json'), '{}');
    await writeFile(
      path.join(directory, 'session.json'),
      JSON.stringify(makeTestSession()),
    );
    await expect(compileSessionIndex(sessionsRoot)).rejects.toThrow(
      /info\.json/,
    );
  });
});

describe('writeSessionIndex', () => {
  it('writes an index that parses back', async () => {
    const root = await makeGeneratedRoot();
    await writeSession(path.join(root, SESSIONS_DIRECTORY), 'session-a', {
      title: 'A session',
    });

    const written = await writeSessionIndex(root);
    const fromDisk = parseSessionIndex(
      JSON.parse(
        await readFile(
          path.join(root, SESSIONS_DIRECTORY, 'index.json'),
          'utf8',
        ),
      ),
    );
    expect(fromDisk).toEqual(written);
  });
});
