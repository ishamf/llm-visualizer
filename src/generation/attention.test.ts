import { describe, expect, it } from 'vitest';

import {
  contributionRow,
  contributionRows,
  createContributionNormCache,
  queryHeadToKvHead,
} from './attention.ts';
import { HEAD_DIMENSION, KV_HEAD_COUNT, QUERY_HEAD_COUNT } from './config.ts';
import {
  presentKeyOutputName,
  presentValueOutputName,
  queryOutputName,
} from './model-output-names.ts';
import type { ModelOutputs, ModelTensor } from './types.ts';

function tensor(data: Float32Array, dims: number[]): ModelTensor {
  return { data, dims, type: 'float32' };
}

function valueData(sourceCount: number) {
  const data = new Float32Array(KV_HEAD_COUNT * sourceCount * HEAD_DIMENSION);
  for (let kvHead = 0; kvHead < KV_HEAD_COUNT; ++kvHead) {
    for (let source = 0; source < sourceCount; ++source) {
      const offset = (kvHead * sourceCount + source) * HEAD_DIMENSION;
      data[offset] = source + 1;
    }
  }
  return data;
}

function outputsForSourceCount(
  sourceCount: number,
  value: Float32Array,
): ModelOutputs {
  return {
    [queryOutputName(0)]: tensor(
      new Float32Array(QUERY_HEAD_COUNT * HEAD_DIMENSION),
      [1, 1, QUERY_HEAD_COUNT * HEAD_DIMENSION],
    ),
    [presentKeyOutputName(0)]: tensor(
      new Float32Array(KV_HEAD_COUNT * sourceCount * HEAD_DIMENSION),
      [1, KV_HEAD_COUNT, sourceCount, HEAD_DIMENSION],
    ),
    [presentValueOutputName(0)]: tensor(value, [
      1,
      KV_HEAD_COUNT,
      sourceCount,
      HEAD_DIMENSION,
    ]),
  };
}

describe('grouped-query contribution math', () => {
  it('maps each pair of query heads to one KV head', () => {
    expect(
      Array.from({ length: QUERY_HEAD_COUNT }, (_, head) =>
        queryHeadToKvHead(head),
      ),
    ).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7]);
  });

  it('returns causal rows aggregated across heads with root-sum-square', () => {
    const layer = 0;
    const queryCount = 2;
    const sourceCount = 2;
    const query = new Float32Array(
      queryCount * QUERY_HEAD_COUNT * HEAD_DIMENSION,
    );
    const key = new Float32Array(KV_HEAD_COUNT * sourceCount * HEAD_DIMENSION);
    const value = new Float32Array(
      KV_HEAD_COUNT * sourceCount * HEAD_DIMENSION,
    );
    for (let kvHead = 0; kvHead < KV_HEAD_COUNT; ++kvHead) {
      const offset = kvHead * sourceCount * HEAD_DIMENSION;
      value[offset] = 1;
      value[offset + HEAD_DIMENSION] = 2;
    }

    const outputs: ModelOutputs = {
      [queryOutputName(layer)]: tensor(query, [
        1,
        queryCount,
        QUERY_HEAD_COUNT * HEAD_DIMENSION,
      ]),
      [presentKeyOutputName(layer)]: tensor(key, [
        1,
        KV_HEAD_COUNT,
        sourceCount,
        HEAD_DIMENSION,
      ]),
      [presentValueOutputName(layer)]: tensor(value, [
        1,
        KV_HEAD_COUNT,
        sourceCount,
        HEAD_DIMENSION,
      ]),
    };

    const rows = contributionRows(outputs, layer);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([4]);
    expect(rows[1][0]).toBeCloseTo(2, 12);
    expect(rows[1][1]).toBeCloseTo(4, 12);
    expect(contributionRow(outputs, layer, 1)).toEqual(rows[1]);
  });

  it('reuses cached prefix norms and matches uncached rows', () => {
    const layer = 0;
    const cache = createContributionNormCache();
    const prefill = outputsForSourceCount(2, valueData(2));
    contributionRow(prefill, layer, 0, cache);

    const decodedValue = valueData(3);
    const decoded = outputsForSourceCount(3, decodedValue);
    const cachedRow = contributionRow(decoded, layer, 0, cache);
    const uncachedRow = contributionRow(
      outputsForSourceCount(3, decodedValue),
      layer,
      0,
    );

    expect(cachedRow).toEqual(uncachedRow);
  });

  it('computes norms only for newly appended value positions', () => {
    const layer = 0;
    const cache = createContributionNormCache();
    contributionRow(outputsForSourceCount(2, valueData(2)), layer, 0, cache);

    const values = valueData(3);
    let valueReads = 0;
    const trackedValues = new Proxy(values, {
      get(target, property) {
        if (typeof property === 'string' && /^\d+$/.test(property)) {
          valueReads += 1;
        }
        return Reflect.get(target, property);
      },
    });
    const decoded = outputsForSourceCount(
      3,
      trackedValues as unknown as Float32Array,
    );

    contributionRow(decoded, layer, 0, cache);
    expect(valueReads).toBe(KV_HEAD_COUNT * HEAD_DIMENSION);

    contributionRow(decoded, layer, 0, cache);
    expect(valueReads).toBe(KV_HEAD_COUNT * HEAD_DIMENSION);
  });
});
