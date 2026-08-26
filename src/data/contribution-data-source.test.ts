import { describe, expect, it } from 'vitest';

import {
  CONTRIBUTION_METRIC,
  DATASET_SCHEMA_VERSION,
} from '../generation/config.ts';
import type { ContributionDataset } from '../generation/types.ts';
import {
  InMemoryContributionDataSource,
  parseContributionLayer,
  parseContributionManifest,
} from './contribution-data-source.ts';
import {
  LayerSummingContributionDataSource,
  parseSummedContributions,
} from './summed-contribution-data-source.ts';

function dataset(): ContributionDataset {
  return {
    manifest: {
      schemaVersion: DATASET_SCHEMA_VERSION,
      metric: CONTRIBUTION_METRIC,
      model: { id: 'test', dtype: 'f32', instrumentation: 'test' },
      prompt: 'A',
      generatedText: 'B',
      promptTokenCount: 1,
      tokens: [
        { id: 1, text: 'A' },
        { id: 2, text: 'B' },
      ],
      geometry: {
        layers: 1,
        queryHeads: 1,
        kvHeads: 1,
        headDimension: 1,
      },
      generation: {
        method: 'greedy',
        maxNewTokens: 1,
        stopReason: 'max_new_tokens',
      },
      validation: {
        logitsMaxAbsoluteError: 0,
        contextsMaxAbsoluteError: 0,
      },
    },
    layers: [
      {
        schemaVersion: DATASET_SCHEMA_VERSION,
        layer: 0,
        metric: CONTRIBUTION_METRIC,
        rows: [[1], [0.4, 2]],
      },
    ],
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
