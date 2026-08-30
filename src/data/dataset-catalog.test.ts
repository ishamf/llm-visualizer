import { afterEach, describe, expect, it, vi } from 'vitest';

import { exampleDataset } from '../generation/test-fixtures.ts';
import {
  DATASET_CATALOG_SCHEMA_VERSION,
  loadDatasetCatalog,
  matchesModelConfiguration,
  parseDatasetCatalog,
} from './dataset-catalog.ts';

describe('dataset discovery manifest', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('validates and returns catalog entries', () => {
    const manifest = exampleDataset().manifest;
    manifest.model.dtype = 'int8';
    const value = {
      schemaVersion: DATASET_CATALOG_SCHEMA_VERSION,
      modelKey: 'qwen3-0.6b',
      modelVariant: 'int8',
      datasets: [
        {
          id: 'example',
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
        modelKey: 'qwen3-0.6b',
        modelVariant: 'int8',
        datasets: [
          {
            id: 'example',
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

  it('loads only the configured model and variant manifest', async () => {
    const manifest = exampleDataset().manifest;
    manifest.model.dtype = 'int8';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        schemaVersion: DATASET_CATALOG_SCHEMA_VERSION,
        modelKey: 'qwen3-0.6b',
        modelVariant: 'int8',
        datasets: [
          {
            id: 'example',
            format: 'summed',
            path: 'summed-contributions/qwen3-0.6b/int8/example/',
            manifest,
          },
        ],
      }),
    });
    vi.stubGlobal('document', { baseURI: 'https://app.example/' });
    vi.stubGlobal('fetch', fetchMock);

    const datasets = await loadDatasetCatalog('https://data.example/release');

    expect(fetchMock.mock.calls[0]?.[0].href).toBe(
      'https://data.example/release/manifests/qwen3-0.6b/int8.json',
    );
    expect(datasets[0]).toMatchObject({
      modelKey: 'qwen3-0.6b',
      modelVariant: 'int8',
      baseUrl:
        'https://data.example/release/summed-contributions/qwen3-0.6b/int8/example/',
    });
  });
});
