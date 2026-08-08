import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  AutoModelForCausalLM,
  AutoTokenizer,
  env,
  Tensor,
  type Message,
} from '@huggingface/transformers';

const MODEL_ID = 'Qwen3-0.6B-ONNX';
const MODEL_ROOT = fileURLToPath(new URL('../../models/', import.meta.url));
const INSTRUMENTED_MODEL_NAME = 'instrumented';
const LAYER_COUNT = 28;
const QUERY_HEAD_COUNT = 16;
const KV_HEAD_COUNT = 8;
const HEAD_DIM = 128;
const FINAL_LAYER = LAYER_COUNT - 1;
const CONTEXT_ATOL = 0.025;
const LOGITS_ATOL = 1e-5;

type NumericArray = ArrayLike<number>;
type ModelTensor = {
  data: NumericArray;
  dims: number[];
  type: string;
  dispose?: () => void;
};
type ModelOutputs = Record<string, ModelTensor>;

type ValidationStats = {
  count: number;
  maxAbsoluteError: number;
  meanAbsoluteError: number;
};

type TokenContribution = {
  destinationIndex: number;
  sourceIndex: number | null;
  magnitude: number;
};

const queryName = (layer: number) =>
  `/model/layers.${layer}/attn/q_rotary/RotaryEmbedding/output_0`;
const contextName = (layer: number) =>
  `/model/layers.${layer}/attn/GroupQueryAttention/output_0`;

function assertShape(
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

function compareArrays(actual: NumericArray, expected: NumericArray) {
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
    meanAbsoluteError: sum / actual.length,
  } satisfies ValidationStats;
}

function attentionWeights(
  query: NumericArray,
  key: NumericArray,
  queryOffset: number,
  kvHeadOffset: number,
  sourceCount: number,
) {
  const scores = new Float64Array(sourceCount);
  let maximum = -Infinity;

  for (let source = 0; source < sourceCount; ++source) {
    const keyOffset = kvHeadOffset + source * HEAD_DIM;
    let score = 0;
    for (let channel = 0; channel < HEAD_DIM; ++channel) {
      score +=
        Number(query[queryOffset + channel]) * Number(key[keyOffset + channel]);
    }
    score /= Math.sqrt(HEAD_DIM);
    scores[source] = score;
    maximum = Math.max(maximum, score);
  }

  let denominator = 0;
  for (let source = 0; source < sourceCount; ++source) {
    const exponential = Math.exp(scores[source] - maximum);
    scores[source] = exponential;
    denominator += exponential;
  }
  for (let source = 0; source < sourceCount; ++source) {
    scores[source] /= denominator;
  }
  return scores;
}

/**
 * Reconstructs every head's attention context for one layer and compares it
 * with the promoted GroupQueryAttention output.
 */
export function validateAttentionContext(
  outputs: ModelOutputs,
  layer: number,
): ValidationStats {
  const query = outputs[queryName(layer)];
  const key = outputs[`present.${layer}.key`];
  const value = outputs[`present.${layer}.value`];
  const expectedContext = outputs[contextName(layer)];

  if (!query || !key || !value || !expectedContext) {
    throw new Error(`Layer ${layer} is missing Q, K, V, or validation context`);
  }

  const queryCount = query.dims[1];
  const sourceCount = key.dims[2];
  const firstQueryPosition = sourceCount - queryCount;
  assertShape(queryName(layer), query, [
    1,
    queryCount,
    QUERY_HEAD_COUNT * HEAD_DIM,
  ]);
  assertShape(`present.${layer}.key`, key, [
    1,
    KV_HEAD_COUNT,
    sourceCount,
    HEAD_DIM,
  ]);
  assertShape(`present.${layer}.value`, value, [
    1,
    KV_HEAD_COUNT,
    sourceCount,
    HEAD_DIM,
  ]);
  assertShape(contextName(layer), expectedContext, [
    1,
    queryCount,
    QUERY_HEAD_COUNT * HEAD_DIM,
  ]);

  let maximum = 0;
  let sum = 0;
  let count = 0;
  for (let queryIndex = 0; queryIndex < queryCount; ++queryIndex) {
    const visibleSourceCount = firstQueryPosition + queryIndex + 1;
    for (let queryHead = 0; queryHead < QUERY_HEAD_COUNT; ++queryHead) {
      const kvHead = Math.floor(queryHead / (QUERY_HEAD_COUNT / KV_HEAD_COUNT));
      const queryOffset =
        (queryIndex * QUERY_HEAD_COUNT + queryHead) * HEAD_DIM;
      const kvHeadOffset = kvHead * sourceCount * HEAD_DIM;
      const weights = attentionWeights(
        query.data,
        key.data,
        queryOffset,
        kvHeadOffset,
        visibleSourceCount,
      );

      for (let channel = 0; channel < HEAD_DIM; ++channel) {
        let reconstructed = 0;
        for (let source = 0; source < visibleSourceCount; ++source) {
          reconstructed +=
            weights[source] *
            Number(value.data[kvHeadOffset + source * HEAD_DIM + channel]);
        }
        const contextOffset = queryOffset + channel;
        const difference = Math.abs(
          reconstructed - Number(expectedContext.data[contextOffset]),
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
    meanAbsoluteError: sum / count,
  };
}

/**
 * Finds the strongest *other* source token for each query token using
 * sum_h attention[h, i, j] * L2(value[kvHead(h), j]).
 */
export function strongestTokenContributions(
  outputs: ModelOutputs,
  layer = FINAL_LAYER,
): TokenContribution[] {
  const query = outputs[queryName(layer)];
  const key = outputs[`present.${layer}.key`];
  const value = outputs[`present.${layer}.value`];
  if (!query || !key || !value) {
    throw new Error(`Layer ${layer} is missing Q, K, or V`);
  }

  const queryCount = query.dims[1];
  const sourceCount = key.dims[2];
  const firstQueryPosition = sourceCount - queryCount;
  const valueNorms = Array.from(
    { length: KV_HEAD_COUNT },
    () => new Float64Array(sourceCount),
  );

  for (let kvHead = 0; kvHead < KV_HEAD_COUNT; ++kvHead) {
    const kvHeadOffset = kvHead * sourceCount * HEAD_DIM;
    for (let source = 0; source < sourceCount; ++source) {
      let squaredNorm = 0;
      const valueOffset = kvHeadOffset + source * HEAD_DIM;
      for (let channel = 0; channel < HEAD_DIM; ++channel) {
        const component = Number(value.data[valueOffset + channel]);
        squaredNorm += component * component;
      }
      valueNorms[kvHead][source] = Math.sqrt(squaredNorm);
    }
  }

  const result: TokenContribution[] = [];
  for (let queryIndex = 0; queryIndex < queryCount; ++queryIndex) {
    const destinationIndex = firstQueryPosition + queryIndex;
    const visibleSourceCount = destinationIndex + 1;
    const magnitudes = new Float64Array(visibleSourceCount);

    for (let queryHead = 0; queryHead < QUERY_HEAD_COUNT; ++queryHead) {
      const kvHead = Math.floor(queryHead / (QUERY_HEAD_COUNT / KV_HEAD_COUNT));
      const queryOffset =
        (queryIndex * QUERY_HEAD_COUNT + queryHead) * HEAD_DIM;
      const kvHeadOffset = kvHead * sourceCount * HEAD_DIM;
      const weights = attentionWeights(
        query.data,
        key.data,
        queryOffset,
        kvHeadOffset,
        visibleSourceCount,
      );
      for (let source = 0; source < visibleSourceCount; ++source) {
        magnitudes[source] += weights[source] * valueNorms[kvHead][source];
      }
    }

    let sourceIndex: number | null = null;
    let magnitude = -Infinity;
    for (let source = 0; source < visibleSourceCount; ++source) {
      if (source === destinationIndex) continue;
      if (magnitudes[source] > magnitude) {
        sourceIndex = source;
        magnitude = magnitudes[source];
      }
    }
    result.push({
      destinationIndex,
      sourceIndex,
      magnitude: sourceIndex === null ? 0 : magnitude,
    });
  }
  return result;
}

function pastKeyValues(outputs: ModelOutputs) {
  const cache: Record<string, ModelTensor> = {};
  for (let layer = 0; layer < LAYER_COUNT; ++layer) {
    cache[`past_key_values.${layer}.key`] = outputs[`present.${layer}.key`];
    cache[`past_key_values.${layer}.value`] = outputs[`present.${layer}.value`];
  }
  return cache;
}

function argmaxLastLogit(logits: ModelTensor) {
  const vocabularySize = logits.dims.at(-1)!;
  const offset = logits.data.length - vocabularySize;
  let bestToken = 0;
  let bestLogit = -Infinity;
  for (let token = 0; token < vocabularySize; ++token) {
    const logit = Number(logits.data[offset + token]);
    if (logit > bestLogit) {
      bestLogit = logit;
      bestToken = token;
    }
  }
  return BigInt(bestToken);
}

function oneTokenTensor(token: bigint) {
  return new Tensor('int64', [token], [1, 1]);
}

function attentionMask(length: number) {
  return new Tensor('int64', Array<bigint>(length).fill(1n), [1, length]);
}

function disposeOutputs(outputs: ModelOutputs) {
  for (const tensor of Object.values(outputs)) {
    tensor.dispose?.();
  }
}

function displayToken(
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>,
  token: bigint,
) {
  return JSON.stringify(
    tokenizer.decode([token], {
      skip_special_tokens: false,
      clean_up_tokenization_spaces: false,
    }),
  );
}

function printContribution(
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>,
  tokenIds: bigint[],
  contribution: TokenContribution,
) {
  const destination = displayToken(
    tokenizer,
    tokenIds[contribution.destinationIndex],
  );
  const source =
    contribution.sourceIndex === null
      ? '[none]'
      : `[${contribution.sourceIndex} ${displayToken(
          tokenizer,
          tokenIds[contribution.sourceIndex],
        )}]`;
  console.log(
    `${contribution.destinationIndex} ${destination} ${contribution.magnitude.toFixed(6)} <- ${source}`,
  );
}

async function main() {
  const prompt = process.argv.slice(2).join(' ').trim() || 'Say hello briefly.';
  const maxNewTokens = Number(process.env.VALIDATION_MAX_NEW_TOKENS ?? 1_000);
  if (!Number.isSafeInteger(maxNewTokens) || maxNewTokens < 0) {
    throw new Error('VALIDATION_MAX_NEW_TOKENS must be a non-negative integer');
  }
  env.localModelPath = MODEL_ROOT;
  env.allowRemoteModels = false;

  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, {
    local_files_only: true,
  });
  const messages: Message[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: prompt },
  ];
  const inputs = tokenizer.apply_chat_template(messages, {
    tokenize: true,
    return_tensor: true,
    return_dict: true,
    add_generation_prompt: true,
    enable_thinking: false,
  } as Parameters<typeof tokenizer.apply_chat_template>[1] & {
    enable_thinking: boolean;
  }) as unknown as { input_ids: Tensor; attention_mask: Tensor };
  const tokenIds = Array.from(inputs.input_ids.data as BigInt64Array);

  console.error(
    'Checking that instrumentation does not change prompt logits...',
  );
  const original = await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
    dtype: 'q4f16',
    local_files_only: true,
  });
  const originalOutputs = (await original(inputs)) as unknown as ModelOutputs;
  const originalLogits = Float32Array.from(originalOutputs.logits.data);
  disposeOutputs(originalOutputs);
  await original.dispose();

  const model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
    dtype: 'q4f16',
    local_files_only: true,
    model_file_name: INSTRUMENTED_MODEL_NAME,
  });

  try {
    let outputs = (await model(inputs)) as unknown as ModelOutputs;
    const logitStats = compareArrays(outputs.logits.data, originalLogits);
    console.error(
      `logits: max abs ${logitStats.maxAbsoluteError.toExponential(3)}, mean abs ${logitStats.meanAbsoluteError.toExponential(3)}`,
    );
    if (logitStats.maxAbsoluteError > LOGITS_ATOL) {
      throw new Error(
        `Instrumented logits differ by ${logitStats.maxAbsoluteError}, above ${LOGITS_ATOL}`,
      );
    }

    let worstContextError = 0;
    let contextErrorSum = 0;
    let contextValueCount = 0;
    for (let layer = 0; layer < LAYER_COUNT; ++layer) {
      const stats = validateAttentionContext(outputs, layer);
      worstContextError = Math.max(worstContextError, stats.maxAbsoluteError);
      contextErrorSum += stats.meanAbsoluteError * stats.count;
      contextValueCount += stats.count;
    }
    console.error(
      `prefill contexts: max abs ${worstContextError.toExponential(3)}, mean abs ${(contextErrorSum / contextValueCount).toExponential(3)}`,
    );
    if (worstContextError > CONTEXT_ATOL) {
      throw new Error(
        `Prefill context error ${worstContextError} is above ${CONTEXT_ATOL}`,
      );
    }

    console.log('\nindex token contribution <- [source index token]');
    for (const contribution of strongestTokenContributions(outputs)) {
      printContribution(tokenizer, tokenIds, contribution);
    }

    let nextToken = argmaxLastLogit(outputs.logits);
    for (let step = 0; step < maxNewTokens; ++step) {
      tokenIds.push(nextToken);
      const previousOutputs = outputs;
      outputs = (await model({
        input_ids: oneTokenTensor(nextToken),
        attention_mask: attentionMask(tokenIds.length),
        past_key_values: pastKeyValues(previousOutputs),
      })) as unknown as ModelOutputs;
      disposeOutputs(previousOutputs);

      for (let layer = 0; layer < LAYER_COUNT; ++layer) {
        const stats = validateAttentionContext(outputs, layer);
        worstContextError = Math.max(worstContextError, stats.maxAbsoluteError);
        if (stats.maxAbsoluteError > CONTEXT_ATOL) {
          throw new Error(
            `Decode step ${step}, layer ${layer} context error ${stats.maxAbsoluteError} is above ${CONTEXT_ATOL}`,
          );
        }
      }
      printContribution(
        tokenizer,
        tokenIds,
        strongestTokenContributions(outputs)[0],
      );

      if (tokenizer.eos_token_id === Number(nextToken)) {
        break;
      }
      nextToken = argmaxLastLogit(outputs.logits);
    }
    console.error(
      `prefill + decode contexts: worst max abs ${worstContextError.toExponential(3)} (tolerance ${CONTEXT_ATOL})`,
    );
    disposeOutputs(outputs);
  } finally {
    await model.dispose();
  }
}

await main();
