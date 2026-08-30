import { describe, expect, it } from 'vitest';

import { exampleDataset } from '../generation/test-fixtures.ts';
import {
  DATASET_CATALOG_SCHEMA_VERSION,
  matchesModelConfiguration,
  parseDatasetCatalog,
} from './dataset-catalog.ts';

describe('dataset discovery manifest', () => {
  it('validates and returns catalog entries', () => {
    const manifest = exampleDataset().manifest;
    manifest.model.dtype = 'int8';
    const value = {
      schemaVersion: DATASET_CATALOG_SCHEMA_VERSION,
      datasets: [
        {
          id: 'example',
          modelKey: 'qwen3-0.6b',
          modelVariant: 'int8',
          format: 'summed',
          path: 'summed-contributions/qwen3-0.6b/int8/example/',
          manifest,
        },
      ],
    };

    expect(parseDatasetCatalog(value)).toEqual(value);
  });

  it('rejects unsafe artifact paths', () => {
    expect(() =>
      parseDatasetCatalog({
        schemaVersion: DATASET_CATALOG_SCHEMA_VERSION,
        datasets: [
          {
            id: 'example',
            modelKey: 'qwen3-0.6b',
            modelVariant: 'int8',
            format: 'summed',
            path: '../private/',
            manifest: exampleDataset().manifest,
          },
        ],
      }),
    ).toThrow('entry 0 is invalid');
  });

  it('matches homepage datasets by both model and variant', () => {
    expect(
      matchesModelConfiguration({
        modelKey: 'qwen3-0.6b',
        modelVariant: 'int8',
      }),
    ).toBe(true);
    expect(
      matchesModelConfiguration({
        modelKey: 'qwen3-0.6b',
        modelVariant: 'uint8',
      }),
    ).toBe(false);
    expect(
      matchesModelConfiguration({
        modelKey: 'qwen3-1.7b',
        modelVariant: 'int8',
      }),
    ).toBe(false);
  });
});
