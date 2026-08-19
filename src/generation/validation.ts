import {
  CONTEXT_ABSOLUTE_TOLERANCE,
  HEAD_DIMENSION,
  HIDDEN_SIZE,
  KV_HEAD_COUNT,
  LAYER_COUNT,
  LOGITS_ABSOLUTE_TOLERANCE,
  QUERY_HEAD_COUNT,
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
  assertShape(queryName, query, [1, queryCount, HIDDEN_SIZE]);
  assertShape(keyName, key, [1, KV_HEAD_COUNT, sourceCount, HEAD_DIMENSION]);
  assertShape(valueName, value, [
    1,
    KV_HEAD_COUNT,
    sourceCount,
    HEAD_DIMENSION,
  ]);
  assertShape(contextName, expectedContext, [1, queryCount, HIDDEN_SIZE]);

  let maximum = 0;
  let sum = 0;
  let count = 0;
  for (let queryIndex = 0; queryIndex < queryCount; ++queryIndex) {
    const visibleSourceCount = firstQueryPosition + queryIndex + 1;
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

      for (let channel = 0; channel < HEAD_DIMENSION; ++channel) {
        let reconstructed = 0;
        for (let source = 0; source < visibleSourceCount; ++source) {
          reconstructed +=
            weights[source] *
            Number(
              value.data[kvHeadOffset + source * HEAD_DIMENSION + channel],
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

export function validateModelStep(outputs: ModelOutputs) {
  let maximum = 0;
  let sum = 0;
  let count = 0;
  for (let layer = 0; layer < LAYER_COUNT; ++layer) {
    const stats = validateAttentionContext(outputs, layer);
    maximum = Math.max(maximum, stats.maxAbsoluteError);
    sum += stats.meanAbsoluteError * stats.count;
    count += stats.count;
  }

  const stats = {
    count,
    maxAbsoluteError: maximum,
    meanAbsoluteError: count === 0 ? 0 : sum / count,
  } satisfies ValidationStats;
  if (maximum > CONTEXT_ABSOLUTE_TOLERANCE) {
    throw new Error(
      `Attention context error ${maximum} is above ${CONTEXT_ABSOLUTE_TOLERANCE}`,
    );
  }
  return stats;
}

export function validateLogits(
  instrumentedLogits: NumericArray,
  originalLogits: NumericArray,
) {
  const stats = compareArrays(instrumentedLogits, originalLogits);
  if (stats.maxAbsoluteError > LOGITS_ABSOLUTE_TOLERANCE) {
    throw new Error(
      `Instrumented logits differ by ${stats.maxAbsoluteError}, above ${LOGITS_ABSOLUTE_TOLERANCE}`,
    );
  }
  return stats;
}
