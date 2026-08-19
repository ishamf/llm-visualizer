import { HEAD_DIMENSION, KV_HEAD_COUNT, QUERY_HEAD_COUNT } from './config.ts';
import {
  presentKeyOutputName,
  presentValueOutputName,
  queryOutputName,
} from './model-output-names.ts';
import type { ModelOutputs, NumericArray } from './types.ts';

export function queryHeadToKvHead(queryHead: number) {
  return Math.floor(queryHead / (QUERY_HEAD_COUNT / KV_HEAD_COUNT));
}

export function attentionWeights(
  query: NumericArray,
  key: NumericArray,
  queryOffset: number,
  kvHeadOffset: number,
  sourceCount: number,
) {
  if (sourceCount < 1) {
    throw new Error('Attention requires at least one visible source token');
  }

  const weights = new Float64Array(sourceCount);
  let maximum = -Infinity;

  for (let source = 0; source < sourceCount; ++source) {
    const keyOffset = kvHeadOffset + source * HEAD_DIMENSION;
    let score = 0;
    for (let channel = 0; channel < HEAD_DIMENSION; ++channel) {
      score +=
        Number(query[queryOffset + channel]) * Number(key[keyOffset + channel]);
    }
    score /= Math.sqrt(HEAD_DIMENSION);
    weights[source] = score;
    maximum = Math.max(maximum, score);
  }

  let denominator = 0;
  for (let source = 0; source < sourceCount; ++source) {
    const exponential = Math.exp(weights[source] - maximum);
    weights[source] = exponential;
    denominator += exponential;
  }
  for (let source = 0; source < sourceCount; ++source) {
    weights[source] /= denominator;
  }

  return weights;
}

export function valueVectorNorms(value: NumericArray, sourceCount: number) {
  const norms = Array.from(
    { length: KV_HEAD_COUNT },
    () => new Float64Array(sourceCount),
  );

  for (let kvHead = 0; kvHead < KV_HEAD_COUNT; ++kvHead) {
    const kvHeadOffset = kvHead * sourceCount * HEAD_DIMENSION;
    for (let source = 0; source < sourceCount; ++source) {
      const valueOffset = kvHeadOffset + source * HEAD_DIMENSION;
      let squaredNorm = 0;
      for (let channel = 0; channel < HEAD_DIMENSION; ++channel) {
        const component = Number(value[valueOffset + channel]);
        squaredNorm += component * component;
      }
      norms[kvHead][source] = Math.sqrt(squaredNorm);
    }
  }

  return norms;
}

/** Calculates causal RSS contribution rows for every query in one model pass. */
export function contributionRows(outputs: ModelOutputs, layer: number) {
  const query = outputs[queryOutputName(layer)];
  const key = outputs[presentKeyOutputName(layer)];
  const value = outputs[presentValueOutputName(layer)];
  if (!query || !key || !value) {
    throw new Error(`Layer ${layer} is missing Q, K, or V`);
  }

  const queryCount = query.dims[1];
  const sourceCount = key.dims[2];
  const firstQueryPosition = sourceCount - queryCount;
  if (firstQueryPosition < 0) {
    throw new Error(
      `Layer ${layer} has ${queryCount} queries but only ${sourceCount} sources`,
    );
  }

  const norms = valueVectorNorms(value.data, sourceCount);
  const rows: number[][] = [];

  for (let queryIndex = 0; queryIndex < queryCount; ++queryIndex) {
    const visibleSourceCount = firstQueryPosition + queryIndex + 1;
    const squaredMagnitudes = new Float64Array(visibleSourceCount);

    for (let queryHead = 0; queryHead < QUERY_HEAD_COUNT; ++queryHead) {
      const kvHead = queryHeadToKvHead(queryHead);
      const queryOffset =
        (queryIndex * QUERY_HEAD_COUNT + queryHead) * HEAD_DIMENSION;
      const kvHeadOffset = kvHead * sourceCount * HEAD_DIMENSION;
      const weights = attentionWeights(
        query.data,
        key.data,
        queryOffset,
        kvHeadOffset,
        visibleSourceCount,
      );

      for (let source = 0; source < visibleSourceCount; ++source) {
        const magnitude = weights[source] * norms[kvHead][source];
        squaredMagnitudes[source] += magnitude * magnitude;
      }
    }

    rows.push(
      Array.from(squaredMagnitudes, (squaredMagnitude) =>
        Math.sqrt(squaredMagnitude),
      ),
    );
  }

  return rows;
}
