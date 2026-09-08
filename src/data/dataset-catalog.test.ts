import { afterEach, describe, expect, it, vi } from 'vitest';

import { exampleDataset } from '../generation/test-fixtures.ts';
import type { ContributionManifest } from '../generation/types.ts';
import {
  DATASET_CATALOG_SCHEMA_VERSION,
  loadDatasetCatalog,
  matchesModelConfiguration,
  matchingLayeredDataset,
  parseDatasetCatalog,
  type RemoteDataset,
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
      format: 'summed',
      datasets: [
        {
          id: 'example',
          path: 'example/',
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
        format: 'summed',
        datasets: [
          {
            id: 'example',
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
    const fetchMock = vi.fn(async (url: URL) =>
      url.pathname.includes('/contributions/') &&
      !url.pathname.includes('/summed-contributions/')
        ? { ok: false, status: 404, statusText: 'Not Found' }
        : {
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({
              schemaVersion: DATASET_CATALOG_SCHEMA_VERSION,
              modelKey: 'qwen3-0.6b',
              modelVariant: 'int8',
              format: 'summed',
              datasets: [
                {
                  id: 'example',
                  path: 'example/',
                  manifest,
                },
              ],
            }),
          },
    );
    vi.stubGlobal('document', { baseURI: 'https://app.example/' });
    vi.stubGlobal('fetch', fetchMock);

    const datasets = await loadDatasetCatalog('https://data.example/release');

    expect(fetchMock.mock.calls.map(([url]) => url.href)).toEqual([
      'https://data.example/release/contributions/qwen3-0.6b/int8/manifest.json',
      'https://data.example/release/summed-contributions/qwen3-0.6b/int8/manifest.json',
    ]);
    expect(datasets[0]).toMatchObject({
      format: 'summed',
      modelKey: 'qwen3-0.6b',
      modelVariant: 'int8',
      baseUrl:
        'https://data.example/release/summed-contributions/qwen3-0.6b/int8/example/',
    });
  });

  it('loads layered and summed catalogs independently', async () => {
    const manifest = exampleDataset().manifest;
    manifest.model.dtype = 'int8';
    const fetchMock = vi.fn(async (url: URL) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        schemaVersion: DATASET_CATALOG_SCHEMA_VERSION,
        modelKey: 'qwen3-0.6b',
        modelVariant: 'int8',
        format: url.pathname.includes('/summed-contributions/')
          ? 'summed'
          : 'layered',
        datasets: [{ id: 'example', path: 'example/', manifest }],
      }),
    }));
    vi.stubGlobal('document', { baseURI: 'https://app.example/' });
    vi.stubGlobal('fetch', fetchMock);

    const datasets = await loadDatasetCatalog('https://data.example/release');

    expect(datasets.map(({ format }) => format)).toEqual(['layered', 'summed']);
    expect(datasets.map(({ baseUrl }) => baseUrl)).toEqual([
      'https://data.example/release/contributions/qwen3-0.6b/int8/example/',
      'https://data.example/release/summed-contributions/qwen3-0.6b/int8/example/',
    ]);
  });

  it('rejects a catalog stored under the wrong format path', async () => {
    const manifest = exampleDataset().manifest;
    manifest.model.dtype = 'int8';
    vi.stubGlobal('document', { baseURI: 'https://app.example/' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          schemaVersion: DATASET_CATALOG_SCHEMA_VERSION,
          modelKey: 'qwen3-0.6b',
          modelVariant: 'int8',
          format: 'summed',
          datasets: [],
        }),
      }),
    );

    await expect(
      loadDatasetCatalog('https://data.example/release'),
    ).rejects.toThrow('does not match');
  });
});

describe('matching layered dataset', () => {
  const base = exampleDataset().manifest;

  function remoteDataset(
    format: 'layered' | 'summed',
    overrides: Partial<ContributionManifest> = {},
  ): RemoteDataset {
    const manifest = { ...base, ...overrides };
    return {
      id: 'example',
      modelKey: 'qwen3-0.6b',
      modelVariant: manifest.model.dtype,
      format,
      path: 'example/',
      manifest,
      baseUrl: `https://data.example/${format}/example/`,
    };
  }

  it('finds a layered dataset describing the same run', () => {
    const summed = remoteDataset('summed');
    const layered = remoteDataset('layered');
    expect(matchingLayeredDataset(summed, [layered, summed])).toBe(layered);
  });

  it('matches a layered dataset to itself', () => {
    const layered = remoteDataset('layered');
    expect(matchingLayeredDataset(layered, [layered])).toBe(layered);
  });

  it('returns undefined without a layered counterpart', () => {
    const summed = remoteDataset('summed');
    expect(matchingLayeredDataset(summed, [summed])).toBeUndefined();
    expect(matchingLayeredDataset(summed, [])).toBeUndefined();
  });

  it('rejects a counterpart with different tokens', () => {
    const summed = remoteDataset('summed');
    const divergent = remoteDataset('layered', {
      tokens: [...base.tokens, { id: 3, text: '!' }],
    });
    expect(matchingLayeredDataset(summed, [divergent])).toBeUndefined();
  });

  it('rejects a counterpart with a different prompt boundary', () => {
    const summed = remoteDataset('summed');
    const divergent = remoteDataset('layered', { promptTokenCount: 2 });
    expect(matchingLayeredDataset(summed, [divergent])).toBeUndefined();
  });

  it('rejects a counterpart with different layer geometry', () => {
    const summed = remoteDataset('summed');
    const divergent = remoteDataset('layered', {
      geometry: { ...base.geometry, layers: base.geometry.layers + 1 },
    });
    expect(matchingLayeredDataset(summed, [divergent])).toBeUndefined();
  });
});
