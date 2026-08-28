import {
  HEAD_DIMENSION,
  KV_HEAD_COUNT,
  LAYER_COUNT,
  QUERY_HEAD_COUNT,
  type ModelGeometry,
} from './config.ts';
import {
  presentKeyOutputName,
  presentValueOutputName,
  queryOutputName,
} from './model-output-names.ts';
import type { ModelOutputs, ModelTensor, NumericArray } from './types.ts';

type ContributionNormCacheEntry = {
  /** Number of source positions with valid cached norms. */
  sourceCount: number;
  /** Capacity of each norm vector; this can exceed sourceCount. */
  capacity: number;
  norms: Float64Array[];
  value: ModelTensor;
};

/**
 * Per-generation cache for value-vector norms.
 *
 * The generation loop appends one KV position per decode pass. Cached entries
 * therefore reuse all norms before the appended position and calculate only
 * the new suffix. Create one cache per independent generation run.
 */
export type ContributionNormCache = {
  layers: Array<ContributionNormCacheEntry | undefined>;
};

const DEFAULT_GEOMETRY: ModelGeometry = {
  layers: LAYER_COUNT,
  queryHeads: QUERY_HEAD_COUNT,
  kvHeads: KV_HEAD_COUNT,
  headDimension: HEAD_DIMENSION,
};

export function createContributionNormCache(
  geometry: ModelGeometry = DEFAULT_GEOMETRY,
): ContributionNormCache {
  return {
    layers: Array.from({ length: geometry.layers }, () => undefined),
  };
}

export function queryHeadToKvHead(
  queryHead: number,
  geometry: ModelGeometry = DEFAULT_GEOMETRY,
) {
  return Math.floor(queryHead / (geometry.queryHeads / geometry.kvHeads));
}

export function attentionWeights(
  query: NumericArray,
  key: NumericArray,
  queryOffset: number,
  kvHeadOffset: number,
  sourceCount: number,
  headDimension = HEAD_DIMENSION,
) {
  if (sourceCount < 1) {
    throw new Error('Attention requires at least one visible source token');
  }

  const weights = new Float64Array(sourceCount);
  let maximum = -Infinity;

  for (let source = 0; source < sourceCount; ++source) {
    const keyOffset = kvHeadOffset + source * headDimension;
    let score = 0;
    for (let channel = 0; channel < headDimension; ++channel) {
      score +=
        Number(query[queryOffset + channel]) * Number(key[keyOffset + channel]);
    }
    score /= Math.sqrt(headDimension);
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

function fillValueVectorNorms(
  value: NumericArray,
  sourceStart: number,
  sourceCount: number,
  norms: Float64Array[],
  geometry: ModelGeometry,
) {
  for (let kvHead = 0; kvHead < geometry.kvHeads; ++kvHead) {
    const kvHeadOffset = kvHead * sourceCount * geometry.headDimension;
    for (let source = sourceStart; source < sourceCount; ++source) {
      const valueOffset = kvHeadOffset + source * geometry.headDimension;
      let squaredNorm = 0;
      for (let channel = 0; channel < geometry.headDimension; ++channel) {
        const component = Number(value[valueOffset + channel]);
        squaredNorm += component * component;
      }
      norms[kvHead][source] = Math.sqrt(squaredNorm);
    }
  }
}

export function valueVectorNorms(
  value: NumericArray,
  sourceCount: number,
  geometry: ModelGeometry = DEFAULT_GEOMETRY,
) {
  const norms = Array.from(
    { length: geometry.kvHeads },
    () => new Float64Array(sourceCount),
  );
  fillValueVectorNorms(value, 0, sourceCount, norms, geometry);
  return norms;
}

function allocateNorms(capacity: number, geometry: ModelGeometry) {
  return Array.from(
    { length: geometry.kvHeads },
    () => new Float64Array(capacity),
  );
}

function growNorms(
  previous: Float64Array[],
  previousSourceCount: number,
  capacity: number,
) {
  return previous.map((oldNorms) => {
    const nextNorms = new Float64Array(capacity);
    nextNorms.set(oldNorms.subarray(0, previousSourceCount));
    return nextNorms;
  });
}

function cachedValueVectorNorms(
  value: ModelTensor,
  layer: number,
  sourceCount: number,
  cache: ContributionNormCache,
  geometry: ModelGeometry,
) {
  const previous = cache.layers[layer];
  if (
    previous &&
    sourceCount === previous.sourceCount &&
    value === previous.value
  ) {
    return previous.norms;
  }

  // A shorter cache or a same-sized replacement tensor cannot safely reuse
  // the old values. The generation path only grows the KV cache, but this
  // reset keeps the optional cache correct for other callers too.
  if (!previous || sourceCount <= previous.sourceCount) {
    const norms = allocateNorms(sourceCount, geometry);
    fillValueVectorNorms(value.data, 0, sourceCount, norms, geometry);
    cache.layers[layer] = {
      sourceCount,
      capacity: sourceCount,
      norms,
      value,
    };
    return norms;
  }

  const previousSourceCount = previous.sourceCount;
  const capacity =
    previous.capacity >= sourceCount
      ? previous.capacity
      : Math.max(sourceCount, Math.max(1, previous.capacity * 2));
  const norms =
    capacity === previous.capacity
      ? previous.norms
      : growNorms(previous.norms, previousSourceCount, capacity);
  // The model's KV cache is append-only for this generation. Consequently,
  // old norms remain valid and only the newly appended source suffix is read.
  fillValueVectorNorms(
    value.data,
    previousSourceCount,
    sourceCount,
    norms,
    geometry,
  );
  cache.layers[layer] = {
    sourceCount,
    capacity,
    norms,
    value,
  };
  return norms;
}

function contributionInputs(
  outputs: ModelOutputs,
  layer: number,
  normCache?: ContributionNormCache,
  geometry: ModelGeometry = DEFAULT_GEOMETRY,
) {
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

  return {
    query,
    key,
    norms: normCache
      ? cachedValueVectorNorms(value, layer, sourceCount, normCache, geometry)
      : valueVectorNorms(value.data, sourceCount, geometry),
    queryCount,
    sourceCount,
    firstQueryPosition,
  };
}

function calculateContributionRow(
  inputs: ReturnType<typeof contributionInputs>,
  queryIndex: number,
  geometry: ModelGeometry,
) {
  const { query, key, norms, queryCount, sourceCount, firstQueryPosition } =
    inputs;
  if (
    !Number.isSafeInteger(queryIndex) ||
    queryIndex < 0 ||
    queryIndex >= queryCount
  ) {
    throw new Error(`Query ${queryIndex} is outside this model pass`);
  }
  const visibleSourceCount = firstQueryPosition + queryIndex + 1;
  const squaredMagnitudes = new Float64Array(visibleSourceCount);

  for (let queryHead = 0; queryHead < geometry.queryHeads; ++queryHead) {
    const kvHead = queryHeadToKvHead(queryHead, geometry);
    const queryOffset =
      (queryIndex * geometry.queryHeads + queryHead) * geometry.headDimension;
    const kvHeadOffset = kvHead * sourceCount * geometry.headDimension;
    const weights = attentionWeights(
      query.data,
      key.data,
      queryOffset,
      kvHeadOffset,
      visibleSourceCount,
      geometry.headDimension,
    );

    for (let source = 0; source < visibleSourceCount; ++source) {
      const magnitude = weights[source] * norms[kvHead][source];
      squaredMagnitudes[source] += magnitude * magnitude;
    }
  }

  return Array.from(squaredMagnitudes, (squaredMagnitude) =>
    Math.sqrt(squaredMagnitude),
  );
}

/** Calculates the causal RSS contribution row for one query in a model pass. */
export function contributionRow(
  outputs: ModelOutputs,
  layer: number,
  queryIndex: number,
  normCache?: ContributionNormCache,
  geometry: ModelGeometry = DEFAULT_GEOMETRY,
) {
  return calculateContributionRow(
    contributionInputs(outputs, layer, normCache, geometry),
    queryIndex,
    geometry,
  );
}

/** Calculates causal RSS contribution rows for every query in one model pass. */
export function contributionRows(
  outputs: ModelOutputs,
  layer: number,
  normCache?: ContributionNormCache,
  geometry: ModelGeometry = DEFAULT_GEOMETRY,
) {
  const inputs = contributionInputs(outputs, layer, normCache, geometry);
  const rows: number[][] = [];

  for (let queryIndex = 0; queryIndex < inputs.queryCount; ++queryIndex) {
    rows.push(calculateContributionRow(inputs, queryIndex, geometry));
  }

  return rows;
}
