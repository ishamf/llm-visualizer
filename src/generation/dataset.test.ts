import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { describe, expect, it } from 'vitest';

import { assertDatasetDestinationAvailable } from './atomic-dataset.ts';
import {
  validateContributionDataset,
  writeContributionDataset,
} from './dataset.ts';
import { exampleDataset } from './test-fixtures.ts';

describe('contribution datasets', () => {
  it('accepts manifests generated without optional validation', () => {
    const dataset = exampleDataset();
    delete dataset.manifest.validation;
    expect(() => validateContributionDataset(dataset)).not.toThrow();
  });

  it('rejects incomplete causal triangles', () => {
    const dataset = exampleDataset();
    dataset.layers[3].rows[1] = [1];
    expect(() => validateContributionDataset(dataset)).toThrow(
      'Layer 3 row 1 has length 1, expected 2',
    );
  });

  it('validates the layer count declared by the model manifest', () => {
    const dataset = exampleDataset();
    dataset.manifest.geometry.layers = 2;
    dataset.layers = dataset.layers.slice(0, 2);
    expect(() => validateContributionDataset(dataset)).not.toThrow();
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
      await expect(
        assertDatasetDestinationAvailable(root, 'example', false),
      ).rejects.toThrow('use --overwrite');
      await expect(
        assertDatasetDestinationAvailable(root, 'example', true),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
