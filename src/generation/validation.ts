import {
  CONTEXT_ABSOLUTE_TOLERANCE,
  HEAD_DIMENSION,
  KV_HEAD_COUNT,
  LAYER_COUNT,
  LOGITS_ABSOLUTE_TOLERANCE,
  QUERY_HEAD_COUNT,
  type ModelGeometry,
  type ModelProfile,
} from './config.ts';
import { attentionWeights, queryHeadToKvHead } from './attention.ts';
import {
  contextOutputName,
  presentKeyOutputName,
  presentValueOutputName,
  queryOutputName,
} from './model-output-names.ts';
import type {
  ModelOutputs,
  ModelTensor,
  NumericArray,
  ValidationStats,
} from './types.ts';

export function assertShape(
  name: string,
  tensor: ModelTensor | undefined,
  expected: number[],
) {
  if (!tensor) {
    throw new Error(`Missing instrumented output: ${name}`);
  }
  if (
    tensor.dims.length !== expected.length ||
    tensor.dims.some((dimension, index) => dimension !== expected[index])
  ) {
    throw new Error(
      `${name} has shape [${tensor.dims.join(', ')}], expected [${expected.join(', ')}]`,
    );
  }
}

export function compareArrays(
  actual: NumericArray,
  expected: NumericArray,
): ValidationStats {
  if (actual.length !== expected.length) {
    throw new Error(
      `Cannot compare arrays of lengths ${actual.length} and ${expected.length}`,
    );
  }

  let maximum = 0;
  let sum = 0;
  for (let index = 0; index < actual.length; ++index) {
    const difference = Math.abs(
      Number(actual[index]) - Number(expected[index]),
    );
    maximum = Math.max(maximum, difference);
    sum += difference;
  }

  return {
    count: actual.length,
    maxAbsoluteError: maximum,
    meanAbsoluteError: actual.length === 0 ? 0 : sum / actual.length,
  };
}

export function validateAttentionContext(
  outputs: ModelOutputs,
  layer: number,
  geometry: ModelGeometry = {
    layers: LAYER_COUNT,
    queryHeads: QUERY_HEAD_COUNT,
    kvHeads: KV_HEAD_COUNT,
    headDimension: HEAD_DIMENSION,
  },
): ValidationStats {
  const queryName = queryOutputName(layer);
  const keyName = presentKeyOutputName(layer);
  const valueName = presentValueOutputName(layer);
  const contextName = contextOutputName(layer);
  const query = outputs[queryName];
  const key = outputs[keyName];
  const value = outputs[valueName];
  const expectedContext = outputs[contextName];

  if (!query || !key || !value || !expectedContext) {
    throw new Error(`Layer ${layer} is missing Q, K, V, or validation context`);
  }

  const queryCount = query.dims[1];
  const sourceCount = key.dims[2];
  const firstQueryPosition = sourceCount - queryCount;
  const hiddenSize = geometry.queryHeads * geometry.headDimension;
  assertShape(queryName, query, [1, queryCount, hiddenSize]);
  assertShape(keyName, key, [
    1,
    geometry.kvHeads,
    sourceCount,
    geometry.headDimension,
  ]);
  assertShape(valueName, value, [
    1,
    geometry.kvHeads,
    sourceCount,
    geometry.headDimension,
  ]);
  assertShape(contextName, expectedContext, [1, queryCount, hiddenSize]);

  let maximum = 0;
  let sum = 0;
  let count = 0;
  for (let queryIndex = 0; queryIndex < queryCount; ++queryIndex) {
    const visibleSourceCount = firstQueryPosition + queryIndex + 1;
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

      for (let channel = 0; channel < geometry.headDimension; ++channel) {
        let reconstructed = 0;
        for (let source = 0; source < visibleSourceCount; ++source) {
          reconstructed +=
            weights[source] *
            Number(
              value.data[
                kvHeadOffset + source * geometry.headDimension + channel
              ],
            );
        }
        const difference = Math.abs(
          reconstructed - Number(expectedContext.data[queryOffset + channel]),
        );
        maximum = Math.max(maximum, difference);
        sum += difference;
        ++count;
      }
    }
  }

  return {
    count,
    maxAbsoluteError: maximum,
    meanAbsoluteError: count === 0 ? 0 : sum / count,
  };
}

export function validateModelStep(
  outputs: ModelOutputs,
  profile?: Pick<ModelProfile, 'geometry' | 'contextAbsoluteTolerance'>,
) {
  const geometry = profile?.geometry ?? {
    layers: LAYER_COUNT,
    queryHeads: QUERY_HEAD_COUNT,
    kvHeads: KV_HEAD_COUNT,
    headDimension: HEAD_DIMENSION,
  };
  const tolerance =
    profile?.contextAbsoluteTolerance ?? CONTEXT_ABSOLUTE_TOLERANCE;
  let maximum = 0;
  let sum = 0;
  let count = 0;
  for (let layer = 0; layer < geometry.layers; ++layer) {
    const stats = validateAttentionContext(outputs, layer, geometry);
    maximum = Math.max(maximum, stats.maxAbsoluteError);
    sum += stats.meanAbsoluteError * stats.count;
    count += stats.count;
  }

  const stats = {
    count,
    maxAbsoluteError: maximum,
    meanAbsoluteError: count === 0 ? 0 : sum / count,
  } satisfies ValidationStats;
  if (maximum > tolerance) {
    throw new Error(`Attention context error ${maximum} is above ${tolerance}`);
  }
  return stats;
}

export function validateLogits(
  instrumentedLogits: NumericArray,
  originalLogits: NumericArray,
  tolerance = LOGITS_ABSOLUTE_TOLERANCE,
) {
  const stats = compareArrays(instrumentedLogits, originalLogits);
  if (stats.maxAbsoluteError > tolerance) {
    throw new Error(
      `Instrumented logits differ by ${stats.maxAbsoluteError}, above ${tolerance}`,
    );
  }
  return stats;
}
