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
import type { SummedContributionDataset } from './types.ts';

function exampleSummedDataset(): SummedContributionDataset {
  const layered = exampleDataset();
  return {
    manifest: layered.manifest,
    contributions: {
      schemaVersion: layered.manifest.schemaVersion,
      metric: layered.manifest.metric,
      aggregation: 'sum',
      layerCount: LAYER_COUNT,
      rows: [[LAYER_COUNT], [0.5 * LAYER_COUNT, 2 * LAYER_COUNT]],
    },
  };
}

describe('summed contribution datasets', () => {
  it('rejects incomplete causal triangles', () => {
    const dataset = exampleSummedDataset();
    dataset.contributions.rows[1] = [1];
    expect(() => validateSummedContributionDataset(dataset)).toThrow(
      'row 1 has length 1, expected 2',
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
      expect(contributions.rows).toHaveLength(2);
      await expect(
        writeSummedContributionDataset(root, 'example', exampleSummedDataset()),
      ).rejects.toThrow('use --overwrite');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
