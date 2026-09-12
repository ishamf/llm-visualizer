import { describe, expect, it } from 'vitest';

import {
  parseSessionIndex,
  parseSessionInfo,
  type SessionIndex,
} from './session-index.ts';

const VALID_INDEX: SessionIndex = {
  schemaVersion: 1,
  sessions: [
    {
      id: 'layer-settings-popup',
      path: 'layer-settings-popup/',
      info: { title: 'Layer settings popup', description: 'An example run' },
      model: 'deepseek-v4.1-flash',
      provider: 'opencode-go',
      requestCount: 36,
      outputTokens: 14336,
      totalCost: 0.0149,
      durationSeconds: 183,
    },
  ],
};

describe('parseSessionInfo', () => {
  it('accepts a title with an optional description', () => {
    expect(parseSessionInfo({ title: 'A session' })).toEqual({
      title: 'A session',
      description: undefined,
    });
    expect(
      parseSessionInfo({ title: 'A session', description: 'Details' }),
    ).toEqual({ title: 'A session', description: 'Details' });
  });

  it('rejects missing or mistyped fields', () => {
    expect(() => parseSessionInfo(null)).toThrow();
    expect(() => parseSessionInfo({})).toThrow();
    expect(() => parseSessionInfo({ title: '' })).toThrow();
    expect(() => parseSessionInfo({ title: 42 })).toThrow();
    expect(() =>
      parseSessionInfo({ title: 'A session', description: 42 }),
    ).toThrow();
  });
});

describe('parseSessionIndex', () => {
  it('round-trips a valid index', () => {
    expect(parseSessionIndex(VALID_INDEX)).toEqual(VALID_INDEX);
  });

  it('rejects an unsupported schema version', () => {
    expect(() =>
      parseSessionIndex({ ...VALID_INDEX, schemaVersion: 2 }),
    ).toThrow(/unsupported shape/);
  });

  it('rejects unsafe ids and paths', () => {
    for (const id of ['', '/absolute', '../escape', 'a/../b']) {
      const index = {
        ...VALID_INDEX,
        sessions: [{ ...VALID_INDEX.sessions[0], id }],
      };
      expect(() => parseSessionIndex(index)).toThrow(/invalid id/);
    }
    for (const path of ['', '/absolute/', '../escape/', 'no-trailing']) {
      const index = {
        ...VALID_INDEX,
        sessions: [{ ...VALID_INDEX.sessions[0], path }],
      };
      expect(() => parseSessionIndex(index)).toThrow(/invalid path/);
    }
  });

  it('rejects negative or non-finite statistics', () => {
    for (const requestCount of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const index = {
        ...VALID_INDEX,
        sessions: [{ ...VALID_INDEX.sessions[0], requestCount }],
      };
      expect(() => parseSessionIndex(index)).toThrow(/invalid requestCount/);
    }
  });
});
