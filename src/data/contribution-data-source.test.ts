import { describe, expect, it, vi } from 'vitest';

import {
  CONTRIBUTION_METRIC,
  DATASET_SCHEMA_VERSION,
} from '../generation/config.ts';
import type {
  ContributionDataset,
  ContributionLayer,
  ContributionManifest,
} from '../generation/types.ts';
import {
  InMemoryContributionDataSource,
  parseContributionLayer,
  parseContributionManifest,
} from './contribution-data-source.ts';
import {
  LayerSummingContributionDataSource,
  parseSummedContributions,
} from './summed-contribution-data-source.ts';

function manifestFor(
  tokens: number,
  layers: number,
  promptTokenCount: number,
): ContributionManifest {
  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    metric: CONTRIBUTION_METRIC,
    model: { id: 'test', dtype: 'f32', instrumentation: 'test' },
    prompt: 'A',
    generatedText: 'B',
    promptTokenCount,
    tokens: Array.from({ length: tokens }, (_, index) => ({
      id: index + 1,
      text: `t${index}`,
    })),
    geometry: {
      layers,
      queryHeads: 1,
      kvHeads: 1,
      headDimension: 1,
    },
    generation: {
      method: 'greedy',
      maxNewTokens: tokens - promptTokenCount,
      stopReason: 'max_new_tokens',
    },
    validation: {
      logitsMaxAbsoluteError: 0,
      contextsMaxAbsoluteError: 0,
    },
  };
}

function layer(layer: number, rows: number[][]): ContributionLayer {
  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    layer,
    metric: CONTRIBUTION_METRIC,
    rows,
  };
}

function dataset(): ContributionDataset {
  return {
    manifest: manifestFor(2, 1, 1),
    layers: [layer(0, [[1], [0.4, 2]])],
  };
}

function layeredDataset(layerRows: number[][][]): ContributionDataset {
  const tokenCount = layerRows[0].length;
  return {
    manifest: manifestFor(tokenCount, layerRows.length, 1),
    layers: layerRows.map((rows, layerIndex) => layer(layerIndex, rows)),
  };
}

describe('contribution data sources', () => {
  it('supports the same asynchronous contract for in-memory data', async () => {
    const value = dataset();
    const source = new InMemoryContributionDataSource('memory', value);

    await expect(source.getManifest()).resolves.toBe(value.manifest);
    await expect(source.getLayer(0)).resolves.toBe(value.layers[0]);
    await expect(source.getLayer(1)).rejects.toThrow('does not contain layer');
  });

  it('validates manifest and causal layer boundaries', () => {
    const value = dataset();
    const manifest = parseContributionManifest(value.manifest);
    expect(parseContributionLayer(value.layers[0], manifest, 0)).toBe(
      value.layers[0],
    );

    expect(() =>
      parseContributionLayer(
        { ...value.layers[0], rows: [[1], [0.4]] },
        manifest,
        0,
      ),
    ).toThrow('not causal');
  });

  it('accepts an optional non-empty manifest title', () => {
    const value = dataset();
    const titled = {
      ...value.manifest,
      title: 'Example dataset',
    };

    expect(parseContributionManifest(titled).title).toBe('Example dataset');
    expect(() =>
      parseContributionManifest({ ...value.manifest, title: '  ' }),
    ).toThrow('unsupported shape');
  });

  it('adapts layered data to the summed-data contract', async () => {
    const value = dataset();
    const source = new LayerSummingContributionDataSource(
      new InMemoryContributionDataSource('memory', value),
    );

    await expect(source.getContributions()).resolves.toEqual({
      schemaVersion: DATASET_SCHEMA_VERSION,
      metric: CONTRIBUTION_METRIC,
      aggregation: 'sum',
      layerCount: 1,
      targetTokenStart: 1,
      rows: [[1]],
    });
  });

  it('sums an inclusive sub-range of layers', async () => {
    const value = layeredDataset([
      [[1], [2, 3], [4, 5, 6]],
      [[10], [20, 30], [40, 50, 60]],
      [[100], [200, 300], [400, 500, 600]],
    ]);
    const source = new LayerSummingContributionDataSource(
      new InMemoryContributionDataSource('memory', value),
    );

    await expect(
      source.getContributions(undefined, { firstLayer: 1, lastLayer: 2 }),
    ).resolves.toEqual({
      schemaVersion: DATASET_SCHEMA_VERSION,
      metric: CONTRIBUTION_METRIC,
      aggregation: 'sum',
      layerCount: 2,
      targetTokenStart: 1,
      rows: [[110], [220, 330]],
    });
    await expect(
      source.getContributions(undefined, { firstLayer: 1, lastLayer: 1 }),
    ).resolves.toEqual({
      schemaVersion: DATASET_SCHEMA_VERSION,
      metric: CONTRIBUTION_METRIC,
      aggregation: 'sum',
      layerCount: 1,
      targetTokenStart: 1,
      rows: [[10], [20, 30]],
    });
  });

  it('rejects layer ranges outside the dataset', async () => {
    const value = layeredDataset([[[1], [2, 3], [4, 5, 6]]]);
    const source = new LayerSummingContributionDataSource(
      new InMemoryContributionDataSource('memory', value),
    );

    await expect(
      source.getContributions(undefined, { firstLayer: 0, lastLayer: 1 }),
    ).rejects.toThrow('outside the dataset');
    await expect(
      source.getContributions(undefined, { firstLayer: 1, lastLayer: 0 }),
    ).rejects.toThrow('outside the dataset');
    await expect(
      source.getContributions(undefined, { firstLayer: -1, lastLayer: 0 }),
    ).rejects.toThrow('outside the dataset');
  });

  it('reuses layer downloads across range changes', async () => {
    const value = layeredDataset([
      [[1], [2, 3], [4, 5, 6]],
      [[10], [20, 30], [40, 50, 60]],
    ]);
    const inner = new InMemoryContributionDataSource('memory', value);
    const getLayer = vi.spyOn(inner, 'getLayer');
    const source = new LayerSummingContributionDataSource(inner);

    await source.getContributions(undefined, { firstLayer: 0, lastLayer: 0 });
    await source.getContributions(undefined, { firstLayer: 0, lastLayer: 1 });
    await source.getContributions();

    expect(getLayer.mock.calls.map(([layer]) => layer)).toEqual([0, 1]);
  });

  it('validates pre-summed causal rows', () => {
    const manifest = dataset().manifest;
    expect(
      parseSummedContributions(
        {
          schemaVersion: DATASET_SCHEMA_VERSION,
          metric: CONTRIBUTION_METRIC,
          aggregation: 'sum',
          layerCount: 1,
          rows: [[1], [0.4, 2]],
        },
        manifest,
      ).rows,
    ).toHaveLength(2);
    expect(() =>
      parseSummedContributions(
        {
          schemaVersion: DATASET_SCHEMA_VERSION,
          metric: CONTRIBUTION_METRIC,
          aggregation: 'sum',
          layerCount: 1,
          rows: [[1], [0.4]],
        },
        manifest,
      ),
    ).toThrow('not causal');
  });
});
