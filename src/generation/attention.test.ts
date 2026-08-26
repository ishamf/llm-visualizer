import { describe, expect, it } from 'vitest';

import {
  contributionRow,
  contributionRows,
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
});
