import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { LAYER_COUNT } from './config.ts';
import { exampleDataset } from './test-fixtures.ts';
import {
  validateSummedContributionDataset,
  writeSummedContributionDataset,
} from './summed-dataset.ts';
import type {
  LayeredGeneratedContributions,
  SummedContributionDataset,
} from './types.ts';

function exampleSummedDataset(): SummedContributionDataset {
  const layered = exampleDataset();
  return {
    manifest: layered.manifest,
    contributions: {
      schemaVersion: layered.manifest.schemaVersion,
      metric: layered.manifest.metric,
      aggregation: 'sum',
      layerCount: LAYER_COUNT,
      targetTokenStart: layered.manifest.promptTokenCount,
      rows: [[LAYER_COUNT]],
    },
  };
}

function exampleLayeredGeneratedDataset(): SummedContributionDataset {
  const dataset = exampleSummedDataset();
  return {
    manifest: { ...dataset.manifest, layeredGeneratedContributions: true },
    contributions: dataset.contributions,
    layers: Array.from({ length: LAYER_COUNT }, (_, layer) => ({
      schemaVersion: dataset.manifest.schemaVersion,
      layer,
      metric: dataset.manifest.metric,
      targetTokenStart: dataset.manifest.promptTokenCount,
      rows: [[1]],
    })),
  };
}

describe('summed contribution datasets', () => {
  it('rejects incomplete causal triangles', () => {
    const dataset = exampleSummedDataset();
    dataset.contributions.rows[0] = [];
    expect(() => validateSummedContributionDataset(dataset)).toThrow(
      'row 0 has length 0, expected 1',
    );
  });

  it('accepts layered generated contributions that sum exactly', () => {
    expect(() =>
      validateSummedContributionDataset(exampleLayeredGeneratedDataset()),
    ).not.toThrow();
  });

  it('requires the manifest flag to match the layer matrices', () => {
    const withoutFlag = exampleLayeredGeneratedDataset();
    withoutFlag.manifest = { ...withoutFlag.manifest };
    delete withoutFlag.manifest.layeredGeneratedContributions;
    expect(() => validateSummedContributionDataset(withoutFlag)).toThrow(
      'does not declare them',
    );

    const withoutLayers = exampleSummedDataset();
    withoutLayers.manifest = {
      ...withoutLayers.manifest,
      layeredGeneratedContributions: true,
    };
    expect(() => validateSummedContributionDataset(withoutLayers)).toThrow(
      'none are present',
    );
  });

  it('rejects layer matrices that do not sum to the summed rows', () => {
    const dataset = exampleLayeredGeneratedDataset();
    dataset.layers![0].rows[0][0] = 2;
    expect(() => validateSummedContributionDataset(dataset)).toThrow(
      'do not sum to the summed contributions at row 0 source 0',
    );
  });

  it('rejects malformed layer matrices', () => {
    const dataset = exampleLayeredGeneratedDataset();
    dataset.layers![3] = { ...dataset.layers![3], rows: [[1], [2, 3]] };
    expect(() => validateSummedContributionDataset(dataset)).toThrow(
      'Layer 3 has 2 rows, expected 1',
    );

    const mislabeled = exampleLayeredGeneratedDataset();
    mislabeled.layers![3] = { ...mislabeled.layers![3], layer: 4 };
    expect(() => validateSummedContributionDataset(mislabeled)).toThrow(
      'index 3 reports layer 4',
    );
  });

  it('writes a manifest and one validated contribution matrix', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'summed-contributions-test-'),
    );
    try {
      const destination = await writeSummedContributionDataset(
        root,
        'example',
        exampleSummedDataset(),
      );
      const contributions = JSON.parse(
        await readFile(path.join(destination, 'contributions.json'), 'utf8'),
      ) as { aggregation: string; rows: unknown[] };
      expect(contributions.aggregation).toBe('sum');
      expect(contributions.rows).toHaveLength(1);
      await expect(
        writeSummedContributionDataset(root, 'example', exampleSummedDataset()),
      ).rejects.toThrow('use --overwrite');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes and revalidates per-layer generated-token matrices', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'summed-contributions-test-'),
    );
    try {
      const destination = await writeSummedContributionDataset(
        root,
        'example',
        exampleLayeredGeneratedDataset(),
      );
      const manifest = JSON.parse(
        await readFile(path.join(destination, 'manifest.json'), 'utf8'),
      ) as { layeredGeneratedContributions?: boolean };
      expect(manifest.layeredGeneratedContributions).toBe(true);
      const layer = JSON.parse(
        await readFile(path.join(destination, 'layer-00.json'), 'utf8'),
      ) as LayeredGeneratedContributions;
      expect(layer).toMatchObject({
        layer: 0,
        targetTokenStart: 1,
        rows: [[1]],
      });

      // A staged layer file that breaks the exact sum must fail validation
      // before anything is published.
      const corrupt = exampleLayeredGeneratedDataset();
      corrupt.layers![LAYER_COUNT - 1].rows[0][0] = 1.5;
      await expect(
        writeSummedContributionDataset(root, 'corrupt', corrupt),
      ).rejects.toThrow('do not sum to the summed contributions');
      await expect(() =>
        readFile(path.join(root, 'corrupt', 'contributions.json'), 'utf8'),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
