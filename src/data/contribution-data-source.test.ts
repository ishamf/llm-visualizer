import { describe, expect, it, vi } from 'vitest';

import {
  CONTRIBUTION_METRIC,
  DATASET_SCHEMA_VERSION,
} from '../generation/config.ts';
import type {
  ContributionDataset,
  ContributionLayer,
  ContributionManifest,
} from '../generation/types.ts';
import {
  InMemoryContributionDataSource,
  parseContributionLayer,
  parseContributionManifest,
} from './contribution-data-source.ts';
import {
  HttpSummedContributionDataSource,
  LayerSummingContributionDataSource,
  parseLayeredGeneratedContributions,
  parseSummedContributions,
} from './summed-contribution-data-source.ts';

function manifestFor(
  tokens: number,
  layers: number,
  promptTokenCount: number,
): ContributionManifest {
  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    metric: CONTRIBUTION_METRIC,
    model: { id: 'test', dtype: 'f32', instrumentation: 'test' },
    prompt: 'A',
    generatedText: 'B',
    promptTokenCount,
    tokens: Array.from({ length: tokens }, (_, index) => ({
      id: index + 1,
      text: `t${index}`,
    })),
    geometry: {
      layers,
      queryHeads: 1,
      kvHeads: 1,
      headDimension: 1,
    },
    generation: {
      method: 'greedy',
      maxNewTokens: tokens - promptTokenCount,
      stopReason: 'max_new_tokens',
    },
    validation: {
      logitsMaxAbsoluteError: 0,
      contextsMaxAbsoluteError: 0,
    },
  };
}

function layer(layer: number, rows: number[][]): ContributionLayer {
  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    layer,
    metric: CONTRIBUTION_METRIC,
    rows,
  };
}

function dataset(): ContributionDataset {
  return {
    manifest: manifestFor(2, 1, 1),
    layers: [layer(0, [[1], [0.4, 2]])],
  };
}

function layeredDataset(layerRows: number[][][]): ContributionDataset {
  const tokenCount = layerRows[0].length;
  return {
    manifest: manifestFor(tokenCount, layerRows.length, 1),
    layers: layerRows.map((rows, layerIndex) => layer(layerIndex, rows)),
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

  it('accepts an optional non-empty manifest title', () => {
    const value = dataset();
    const titled = {
      ...value.manifest,
      title: 'Example dataset',
    };

    expect(parseContributionManifest(titled).title).toBe('Example dataset');
    expect(() =>
      parseContributionManifest({ ...value.manifest, title: '  ' }),
    ).toThrow('unsupported shape');
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

  it('sums an inclusive sub-range of layers', async () => {
    const value = layeredDataset([
      [[1], [2, 3], [4, 5, 6]],
      [[10], [20, 30], [40, 50, 60]],
      [[100], [200, 300], [400, 500, 600]],
    ]);
    const source = new LayerSummingContributionDataSource(
      new InMemoryContributionDataSource('memory', value),
    );

    await expect(
      source.getContributions(undefined, { firstLayer: 1, lastLayer: 2 }),
    ).resolves.toEqual({
      schemaVersion: DATASET_SCHEMA_VERSION,
      metric: CONTRIBUTION_METRIC,
      aggregation: 'sum',
      layerCount: 2,
      targetTokenStart: 1,
      rows: [[110], [220, 330]],
    });
    await expect(
      source.getContributions(undefined, { firstLayer: 1, lastLayer: 1 }),
    ).resolves.toEqual({
      schemaVersion: DATASET_SCHEMA_VERSION,
      metric: CONTRIBUTION_METRIC,
      aggregation: 'sum',
      layerCount: 1,
      targetTokenStart: 1,
      rows: [[10], [20, 30]],
    });
  });

  it('rejects layer ranges outside the dataset', async () => {
    const value = layeredDataset([[[1], [2, 3], [4, 5, 6]]]);
    const source = new LayerSummingContributionDataSource(
      new InMemoryContributionDataSource('memory', value),
    );

    await expect(
      source.getContributions(undefined, { firstLayer: 0, lastLayer: 1 }),
    ).rejects.toThrow('outside the dataset');
    await expect(
      source.getContributions(undefined, { firstLayer: 1, lastLayer: 0 }),
    ).rejects.toThrow('outside the dataset');
    await expect(
      source.getContributions(undefined, { firstLayer: -1, lastLayer: 0 }),
    ).rejects.toThrow('outside the dataset');
  });

  it('reuses layer downloads across range changes', async () => {
    const value = layeredDataset([
      [[1], [2, 3], [4, 5, 6]],
      [[10], [20, 30], [40, 50, 60]],
    ]);
    const inner = new InMemoryContributionDataSource('memory', value);
    const getLayer = vi.spyOn(inner, 'getLayer');
    const source = new LayerSummingContributionDataSource(inner);

    await source.getContributions(undefined, { firstLayer: 0, lastLayer: 0 });
    await source.getContributions(undefined, { firstLayer: 0, lastLayer: 1 });
    await source.getContributions();

    expect(getLayer.mock.calls.map(([layer]) => layer)).toEqual([0, 1]);
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

describe('layered generated contributions', () => {
  const manifest: ContributionManifest = {
    ...manifestFor(3, 3, 1),
    layeredGeneratedContributions: true,
  };
  const layerFiles: number[][][] = [
    [[1], [2, 3]],
    [[10], [20, 30]],
    [[100], [200, 300]],
  ];

  function generatedLayer(layer: number): Record<string, unknown> {
    return {
      schemaVersion: DATASET_SCHEMA_VERSION,
      layer,
      metric: CONTRIBUTION_METRIC,
      targetTokenStart: manifest.promptTokenCount,
      rows: layerFiles[layer],
    };
  }

  it('validates causal generated-destination rows', () => {
    expect(
      parseLayeredGeneratedContributions(generatedLayer(1), manifest, 1),
    ).toMatchObject({ layer: 1, targetTokenStart: 1, rows: [[10], [20, 30]] });
    expect(() =>
      parseLayeredGeneratedContributions(generatedLayer(1), manifest, 2),
    ).toThrow('invalid shape');
    expect(() =>
      parseLayeredGeneratedContributions(
        { ...generatedLayer(1), targetTokenStart: 2 },
        manifest,
        1,
      ),
    ).toThrow('invalid shape');
    expect(() =>
      parseLayeredGeneratedContributions(
        { ...generatedLayer(1), rows: [[10], [20]] },
        manifest,
        1,
      ),
    ).toThrow('not causal');
  });

  it('serves layer ranges from per-layer generated-token files', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        const file = String(url).split('/').pop()!;
        requests.push(file);
        const files: Record<string, unknown> = {
          'manifest.json': manifest,
          'contributions.json': {
            schemaVersion: DATASET_SCHEMA_VERSION,
            metric: CONTRIBUTION_METRIC,
            aggregation: 'sum',
            layerCount: 3,
            targetTokenStart: 1,
            rows: [[111], [222, 333]],
          },
          'layer-00.json': generatedLayer(0),
          'layer-01.json': generatedLayer(1),
          'layer-02.json': generatedLayer(2),
        };
        if (!(file in files)) {
          return { ok: false, status: 404, statusText: 'Not Found' };
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => files[file],
        };
      }),
    );
    try {
      const source = new HttpSummedContributionDataSource(
        'example',
        'https://data.example/summed-contributions/example/',
      );

      // The full range keeps using the pre-summed file.
      await expect(source.getContributions()).resolves.toMatchObject({
        layerCount: 3,
        rows: [[111], [222, 333]],
      });
      await expect(
        source.getContributions(undefined, { firstLayer: 1, lastLayer: 2 }),
      ).resolves.toEqual({
        schemaVersion: DATASET_SCHEMA_VERSION,
        metric: CONTRIBUTION_METRIC,
        aggregation: 'sum',
        layerCount: 2,
        targetTokenStart: 1,
        rows: [[110], [220, 330]],
      });
      await expect(
        source.getContributions(undefined, { firstLayer: 2, lastLayer: 2 }),
      ).resolves.toMatchObject({ layerCount: 1, rows: [[100], [200, 300]] });

      // Overlapping ranges reuse already-downloaded layers.
      expect(requests.filter((file) => file === 'layer-01.json')).toHaveLength(
        1,
      );
      expect(requests).not.toContain('layer-00.json.404');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects layer requests on datasets without layered matrices', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => manifestFor(3, 3, 1),
      })),
    );
    try {
      const source = new HttpSummedContributionDataSource(
        'example',
        'https://data.example/summed-contributions/example/',
      );
      await expect(source.getGeneratedLayer(0)).rejects.toThrow(
        'does not ship layered generated contributions',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
