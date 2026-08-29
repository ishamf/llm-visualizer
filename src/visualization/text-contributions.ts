import type { ContributionLayer } from '../generation/types.ts';

export const MINIMUM_TOKEN_OPACITY = 0.15;
export const LIGHT_MINIMUM_TOKEN_OPACITY = 0.1;
export const LIGHT_OPACITY_KNEE = {
  strength: 0.1,
  opacity: 0.25,
} as const;
export type ContributionOpacityScale = 'linear' | 'logarithmic';
export type ContributionOpacityKnee = {
  strength: number;
  opacity: number;
};

export type TokenRectangle = Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>;

export function nearestTokenIndex(
  x: number,
  y: number,
  tokenRectangles: ReadonlyArray<ReadonlyArray<TokenRectangle>>,
): number | null {
  let nearestIndex: number | null = null;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;

  for (const [index, rectangles] of tokenRectangles.entries()) {
    for (const rectangle of rectangles) {
      const horizontalDistance =
        x < rectangle.left
          ? rectangle.left - x
          : x > rectangle.right
            ? x - rectangle.right
            : 0;
      const verticalDistance =
        y < rectangle.top
          ? rectangle.top - y
          : y > rectangle.bottom
            ? y - rectangle.bottom
            : 0;
      const distanceSquared =
        horizontalDistance * horizontalDistance +
        verticalDistance * verticalDistance;

      if (distanceSquared < nearestDistanceSquared) {
        nearestIndex = index;
        nearestDistanceSquared = distanceSquared;
      }
    }
  }

  return nearestIndex;
}

export function sumLayerContributions(
  layers: ReadonlyArray<Pick<ContributionLayer, 'rows'>>,
  tokenCount: number,
): number[][] {
  const totals = Array.from({ length: tokenCount }, (_, destination) =>
    Array<number>(destination + 1).fill(0),
  );

  for (const [layerIndex, layer] of layers.entries()) {
    if (layer.rows.length !== tokenCount) {
      throw new Error(
        `Layer ${layerIndex} has ${layer.rows.length} rows, expected ${tokenCount}`,
      );
    }
    for (let destination = 0; destination < tokenCount; destination++) {
      const row = layer.rows[destination];
      if (row.length !== destination + 1) {
        throw new Error(`Layer ${layerIndex} row ${destination} is not causal`);
      }
      for (let source = 0; source < row.length; source++) {
        totals[destination][source] += row[source];
      }
    }
  }

  return totals;
}

export function predictionContributionRow(
  totals: number[][],
  hoveredToken: number,
  targetTokenStart?: number,
): number[] | undefined {
  if (targetTokenStart === undefined) {
    if (hoveredToken < 1) return undefined;
    return totals[hoveredToken - 1];
  }
  if (hoveredToken < targetTokenStart) return undefined;
  return totals[hoveredToken - targetTokenStart];
}

export function contributionOpacity(
  row: number[] | undefined,
  source: number,
  minimum = MINIMUM_TOKEN_OPACITY,
  scale: ContributionOpacityScale = 'linear',
  knee?: ContributionOpacityKnee,
): number {
  if (!row || source >= row.length) return minimum;
  const maximum = Math.max(...row);
  if (maximum <= 0) return minimum;
  const ratio = row[source] / maximum;
  const strength =
    scale === 'logarithmic' ? Math.log1p(9 * ratio) / Math.log(10) : ratio;

  if (knee) {
    if (strength <= knee.strength) {
      return minimum + (knee.opacity - minimum) * (strength / knee.strength);
    }

    return (
      knee.opacity +
      (1 - knee.opacity) * ((strength - knee.strength) / (1 - knee.strength))
    );
  }

  return minimum + (1 - minimum) * strength;
}
