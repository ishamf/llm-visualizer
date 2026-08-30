import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { exampleDataset } from '../generation/test-fixtures.ts';
import {
  compileDatasetManifest,
  compileDatasetManifests,
  writeDatasetManifest,
  writeDatasetManifests,
} from './compile-dataset-manifest.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('compile dataset manifest', () => {
  it('discovers validated layered and summed datasets', async () => {
    const generatedRoot = await mkdtemp(
      path.join(tmpdir(), 'llm-visualizer-manifest-'),
    );
    temporaryDirectories.push(generatedRoot);
    const dataset = exampleDataset();
    dataset.manifest.model.dtype = 'int8';
    const layeredRoot = path.join(
      generatedRoot,
      'contributions/qwen3-0.6b/int8/example',
    );
    const summedRoot = path.join(
      generatedRoot,
      'summed-contributions/qwen3-0.6b/int8/example',
    );
    await Promise.all([
      mkdir(layeredRoot, { recursive: true }),
      mkdir(summedRoot, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        path.join(layeredRoot, 'manifest.json'),
        JSON.stringify(dataset.manifest),
      ),
      writeFile(
        path.join(summedRoot, 'manifest.json'),
        JSON.stringify(dataset.manifest),
      ),
      writeFile(path.join(summedRoot, 'contributions.json'), '{}'),
      ...dataset.layers.map((layer) =>
        writeFile(
          path.join(
            layeredRoot,
            `layer-${layer.layer.toString().padStart(2, '0')}.json`,
          ),
          JSON.stringify(layer),
        ),
      ),
    ]);

    const result = await compileDatasetManifests(generatedRoot);

    expect(result).toMatchObject([
      {
        modelKey: 'qwen3-0.6b',
        modelVariant: 'int8',
        datasets: [
          {
            id: 'example',
            format: 'layered',
            path: 'contributions/qwen3-0.6b/int8/example/',
          },
          {
            id: 'example',
            format: 'summed',
            path: 'summed-contributions/qwen3-0.6b/int8/example/',
          },
        ],
      },
    ]);

    expect(
      await compileDatasetManifest(generatedRoot, 'qwen3-0.6b', 'int8'),
    ).toEqual(result[0]);

    await writeDatasetManifest(generatedRoot, 'qwen3-0.6b', 'int8');
    const written = JSON.parse(
      await readFile(
        path.join(generatedRoot, 'manifests/qwen3-0.6b/int8.json'),
        'utf8',
      ),
    );
    expect(written).toEqual(result[0]);

    await writeDatasetManifests(generatedRoot);
  });
});
