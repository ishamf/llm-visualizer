import { describe, expect, it } from 'vitest';

import { exampleDataset } from '../generation/test-fixtures.ts';
import {
  DATASET_CATALOG_SCHEMA_VERSION,
  parseDatasetCatalog,
} from './dataset-catalog.ts';

describe('dataset discovery manifest', () => {
  it('validates and returns catalog entries', () => {
    const manifest = exampleDataset().manifest;
    const value = {
      schemaVersion: DATASET_CATALOG_SCHEMA_VERSION,
      datasets: [
        {
          id: 'example',
          modelKey: 'qwen3-0.6b',
          format: 'summed',
          path: 'summed-contributions/qwen3-0.6b/example/',
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
            format: 'summed',
            path: '../private/',
            manifest: exampleDataset().manifest,
          },
        ],
      }),
    ).toThrow('entry 0 is invalid');
  });
});
