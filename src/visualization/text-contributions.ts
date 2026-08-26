import type { ContributionLayer } from '../generation/types.ts';

export const MINIMUM_TOKEN_OPACITY = 0.15;
export type ContributionOpacityScale = 'linear' | 'logarithmic';

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
): number[] | undefined {
  if (hoveredToken < 1) return undefined;
  return totals[hoveredToken - 1];
}

export function contributionOpacity(
  row: number[] | undefined,
  source: number,
  minimum = MINIMUM_TOKEN_OPACITY,
  scale: ContributionOpacityScale = 'linear',
): number {
  if (!row || source >= row.length) return minimum;
  const maximum = Math.max(...row);
  if (maximum <= 0) return minimum;
  const ratio = row[source] / maximum;
  const strength =
    scale === 'logarithmic' ? Math.log1p(9 * ratio) / Math.log(10) : ratio;
  return minimum + (1 - minimum) * strength;
}
