import { describe, expect, it } from 'vitest';

import {
  contributionOpacity,
  predictionContributionRow,
  sumLayerContributions,
} from './text-contributions.ts';

describe('summed text contributions', () => {
  const totals = sumLayerContributions(
    [
      { rows: [[1], [2, 3], [4, 5, 6]] },
      { rows: [[10], [20, 30], [40, 50, 60]] },
    ],
    3,
  );

  it('sums every source contribution over all layers', () => {
    expect(totals).toEqual([[11], [22, 33], [44, 55, 66]]);
  });

  it('uses the preceding position when explaining a hovered token', () => {
    expect(predictionContributionRow(totals, 2)).toBe(totals[1]);
    expect(predictionContributionRow(totals, 0)).toBeUndefined();
  });

  it('normalizes opacity while preserving a visible floor', () => {
    const row = [0, 5, 10];
    expect(contributionOpacity(row, 0, 0.2)).toBe(0.2);
    expect(contributionOpacity(row, 1, 0.2)).toBeCloseTo(0.6);
    expect(contributionOpacity(row, 2, 0.2)).toBe(1);
    expect(contributionOpacity(row, 3, 0.2)).toBe(0.2);
  });

  it('can emphasize weaker sources with logarithmic scaling', () => {
    const row = [0, 5, 10];
    expect(contributionOpacity(row, 0, 0.2, 'logarithmic')).toBe(0.2);
    expect(contributionOpacity(row, 1, 0.2, 'logarithmic')).toBeGreaterThan(
      contributionOpacity(row, 1, 0.2, 'linear'),
    );
    expect(contributionOpacity(row, 2, 0.2, 'logarithmic')).toBe(1);
  });

  it('uses the floor for an all-zero row', () => {
    expect(contributionOpacity([0, 0], 0, 0.2)).toBe(0.2);
  });

  it('rejects malformed layer geometry', () => {
    expect(() => sumLayerContributions([{ rows: [[1]] }], 2)).toThrow(
      'expected 2',
    );
  });
});
