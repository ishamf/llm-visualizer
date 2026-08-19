import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  CONTRIBUTION_METRIC,
  DATASET_SCHEMA_VERSION,
  HEAD_DIMENSION,
  KV_HEAD_COUNT,
  LAYER_COUNT,
  QUERY_HEAD_COUNT,
} from './config.ts';
import {
  validateContributionDataset,
  writeContributionDataset,
} from './dataset.ts';
import type { ContributionDataset } from './types.ts';

function exampleDataset(): ContributionDataset {
  return {
    manifest: {
      schemaVersion: DATASET_SCHEMA_VERSION,
      metric: CONTRIBUTION_METRIC,
      model: {
        id: 'test-model',
        dtype: 'float32',
        instrumentation: 'test',
      },
      prompt: 'Hello',
      generatedText: ' world',
      promptTokenCount: 1,
      tokens: [
        { id: 1, text: 'Hello' },
        { id: 2, text: ' world' },
      ],
      geometry: {
        layers: LAYER_COUNT,
        queryHeads: QUERY_HEAD_COUNT,
        kvHeads: KV_HEAD_COUNT,
        headDimension: HEAD_DIMENSION,
      },
      generation: {
        method: 'greedy',
        maxNewTokens: 1,
        stopReason: 'max_new_tokens',
      },
      validation: {
        logitsMaxAbsoluteError: 0,
        contextsMaxAbsoluteError: 0.01,
      },
    },
    layers: Array.from({ length: LAYER_COUNT }, (_, layer) => ({
      schemaVersion: DATASET_SCHEMA_VERSION,
      layer,
      metric: CONTRIBUTION_METRIC,
      rows: [[1], [0.5, 2]],
    })),
  };
}

describe('contribution datasets', () => {
  it('rejects incomplete causal triangles', () => {
    const dataset = exampleDataset();
    dataset.layers[3].rows[1] = [1];
    expect(() => validateContributionDataset(dataset)).toThrow(
      'Layer 3 row 1 has length 1, expected 2',
    );
  });

  it('writes a manifest and one validated shard per layer', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'contributions-test-'));
    try {
      const destination = await writeContributionDataset(
        root,
        'example',
        exampleDataset(),
      );
      const manifest = JSON.parse(
        await readFile(path.join(destination, 'manifest.json'), 'utf8'),
      ) as { tokens: unknown[] };
      expect(manifest.tokens).toHaveLength(2);
      await expect(
        readFile(path.join(destination, 'layer-27.json'), 'utf8'),
      ).resolves.toContain('"layer": 27');
      await expect(
        writeContributionDataset(root, 'example', exampleDataset()),
      ).rejects.toThrow('use --overwrite');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
