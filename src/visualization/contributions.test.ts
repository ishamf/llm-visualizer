import { describe, expect, it } from 'vitest';

import {
  contributionPath,
  displayToken,
  nodeCenter,
  rankContributions,
} from './contributions.ts';

describe('contribution visualization helpers', () => {
  it('ranks non-self contributions and applies relative scaling', () => {
    expect(rankContributions([4, 1, 9, 0.01], 2, 2)).toEqual([
      { source: 0, value: 4, strength: 1 },
      { source: 1, value: 1, strength: 0.5 },
    ]);
  });

  it('calculates stable node centers and curved paths', () => {
    expect(nodeCenter(0, 0)).toEqual({ x: 110, y: 134 });
    expect(contributionPath(0, 0, 2)).toBe(
      'M 110 134 C 110 118.6, 262 118.6, 262 134',
    );
  });

  it('makes whitespace tokens visible', () => {
    expect(displayToken(' hello\n')).toBe('·hello↵');
    expect(displayToken('')).toBe('∅');
  });
});
