import { describe, expect, it } from 'vitest';

import {
  contributionOpacity,
  nearestTokenIndex,
  predictionContributionRow,
  sumLayerContributions,
} from './text-contributions.ts';

const rectangle = (
  left: number,
  top: number,
  right: number,
  bottom: number,
) => ({ left, top, right, bottom });

describe('nearest text token', () => {
  const tokenRectangles = [
    [rectangle(10, 10, 20, 20)],
    [rectangle(30, 10, 40, 20)],
  ];

  it('selects a token directly beneath the pointer', () => {
    expect(nearestTokenIndex(15, 15, tokenRectangles)).toBe(0);
  });

  it('selects the closest token across horizontal and vertical gaps', () => {
    expect(nearestTokenIndex(26, 15, tokenRectangles)).toBe(1);
    expect(nearestTokenIndex(15, 27, tokenRectangles)).toBe(0);
  });

  it('considers every rectangle of a wrapped token', () => {
    const wrapped = [
      [rectangle(10, 10, 40, 20), rectangle(10, 30, 20, 40)],
      [rectangle(30, 30, 40, 40)],
    ];
    expect(nearestTokenIndex(18, 35, wrapped)).toBe(0);
  });

  it('selects the closest token even at a large distance', () => {
    expect(nearestTokenIndex(100, 100, tokenRectangles)).toBe(1);
  });

  it('uses document order to break equal-distance ties', () => {
    expect(nearestTokenIndex(25, 15, tokenRectangles)).toBe(0);
  });

  it('returns no token when there are no rectangles', () => {
    expect(nearestTokenIndex(15, 15, [])).toBeNull();
  });
});

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

  it('maps compact rows directly to generated target tokens', () => {
    const rows = [
      [1, 2],
      [3, 4, 5],
    ];
    expect(predictionContributionRow(rows, 1, 2)).toBeUndefined();
    expect(predictionContributionRow(rows, 2, 2)).toBe(rows[0]);
    expect(predictionContributionRow(rows, 3, 2)).toBe(rows[1]);
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
