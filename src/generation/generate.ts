import { Tensor } from '@huggingface/transformers';

import {
  CONTRIBUTION_METRIC,
  DATASET_SCHEMA_VERSION,
  HEAD_DIMENSION,
  INSTRUMENTED_MODEL_NAME,
  KV_HEAD_COUNT,
  LAYER_COUNT,
  MODEL_DTYPE,
  MODEL_ID,
  QUERY_HEAD_COUNT,
} from './config.ts';
import { contributionRows } from './attention.ts';
import {
  pastKeyInputName,
  pastValueInputName,
  presentKeyOutputName,
  presentValueOutputName,
} from './model-output-names.ts';
import type {
  CausalLanguageModel,
  ContributionDataset,
  ModelInputs,
  ModelOutputs,
  ModelTensor,
  NumericArray,
  Tokenizer,
  ValidatedPromptConfiguration,
} from './types.ts';
import { validateLogits, validateModelStep } from './validation.ts';

type TokenizedPrompt = {
  inputIds: Tensor;
  attentionMask: Tensor;
  tokenIds: bigint[];
};

export type GenerateContributionDatasetOptions = {
  model: CausalLanguageModel;
  tokenizer: Tokenizer;
  prompt: ValidatedPromptConfiguration;
  originalLogits: NumericArray;
};

export function tokenizePrompt(
  tokenizer: Tokenizer,
  prompt: ValidatedPromptConfiguration,
): TokenizedPrompt {
  const messages: Array<{ role: string; content: string }> = [];
  if (prompt.systemPrompt !== undefined) {
    messages.push({ role: 'system', content: prompt.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt.prompt });

  const encoded = tokenizer.apply_chat_template(messages, {
    tokenize: true,
    return_tensor: true,
    return_dict: true,
    add_generation_prompt: true,
    enable_thinking: false,
  }) as { input_ids: Tensor; attention_mask: Tensor };

  return {
    inputIds: encoded.input_ids,
    attentionMask: encoded.attention_mask,
    tokenIds: Array.from(encoded.input_ids.data as BigInt64Array),
  };
}

export function disposeOutputs(outputs: ModelOutputs) {
  for (const tensor of Object.values(outputs)) {
    tensor.dispose?.();
  }
}

export function disposeTokenizedPrompt(inputs: TokenizedPrompt) {
  inputs.inputIds.dispose();
  inputs.attentionMask.dispose();
}

export function pastKeyValues(outputs: ModelOutputs) {
  const cache: Record<string, ModelTensor> = {};
  for (let layer = 0; layer < LAYER_COUNT; ++layer) {
    const key = outputs[presentKeyOutputName(layer)];
    const value = outputs[presentValueOutputName(layer)];
    if (!key || !value) {
      throw new Error(`Layer ${layer} is missing its key/value cache`);
    }
    cache[pastKeyInputName(layer)] = key;
    cache[pastValueInputName(layer)] = value;
  }
  return cache;
}

export function argmaxLastLogit(logits: ModelTensor) {
  const vocabularySize = logits.dims.at(-1);
  if (!vocabularySize || logits.data.length < vocabularySize) {
    throw new Error(`Invalid logits shape [${logits.dims.join(', ')}]`);
  }

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

function isEosToken(tokenizer: Tokenizer, token: bigint) {
  const eosTokenIds = Array.isArray(tokenizer.eos_token_id)
    ? tokenizer.eos_token_id
    : [tokenizer.eos_token_id];
  return eosTokenIds.some(
    (eosTokenId) => eosTokenId !== null && BigInt(eosTokenId) === token,
  );
}

function numericTokenId(token: bigint) {
  const id = Number(token);
  if (!Number.isSafeInteger(id)) {
    throw new Error(`Token ID ${token} cannot be represented safely in JSON`);
  }
  return id;
}

export async function generateContributionDataset({
  model,
  tokenizer,
  prompt,
  originalLogits,
}: GenerateContributionDatasetOptions): Promise<ContributionDataset> {
  const encoded = tokenizePrompt(tokenizer, prompt);
  const promptTokenCount = encoded.tokenIds.length;
  const tokenIds = [...encoded.tokenIds];
  const generatedTokenIds: bigint[] = [];
  const layerRows = Array.from({ length: LAYER_COUNT }, () => [] as number[][]);
  let logitsMaximumError: number;
  let contextsMaximumError: number;
  let stopReason: 'eos' | 'max_new_tokens' = 'max_new_tokens';
  let outputs: ModelOutputs | undefined;

  try {
    outputs = await model.forward({
      input_ids: encoded.inputIds,
      attention_mask: encoded.attentionMask,
    });
    const logitStats = validateLogits(outputs.logits.data, originalLogits);
    logitsMaximumError = logitStats.maxAbsoluteError;

    const prefillStats = validateModelStep(outputs);
    contextsMaximumError = prefillStats.maxAbsoluteError;
    for (let layer = 0; layer < LAYER_COUNT; ++layer) {
      layerRows[layer].push(...contributionRows(outputs, layer));
    }

    let nextToken = argmaxLastLogit(outputs.logits);
    for (let step = 0; step < prompt.maxNewTokens; ++step) {
      tokenIds.push(nextToken);
      generatedTokenIds.push(nextToken);

      const inputIds = oneTokenTensor(nextToken);
      const mask = attentionMask(tokenIds.length);
      const previousOutputs = outputs;
      try {
        const modelInputs: ModelInputs = {
          input_ids: inputIds,
          attention_mask: mask,
          past_key_values: pastKeyValues(previousOutputs),
        };
        outputs = await model.forward(modelInputs);
      } finally {
        inputIds.dispose();
        mask.dispose();
      }
      disposeOutputs(previousOutputs);

      const decodeStats = validateModelStep(outputs);
      contextsMaximumError = Math.max(
        contextsMaximumError,
        decodeStats.maxAbsoluteError,
      );
      for (let layer = 0; layer < LAYER_COUNT; ++layer) {
        layerRows[layer].push(...contributionRows(outputs, layer));
      }

      if (isEosToken(tokenizer, nextToken)) {
        stopReason = 'eos';
        break;
      }
      if (step + 1 < prompt.maxNewTokens) {
        nextToken = argmaxLastLogit(outputs.logits);
      }
    }

    const tokens = tokenIds.map((token) => ({
      id: numericTokenId(token),
      text: tokenizer.decode([token], {
        skip_special_tokens: false,
        clean_up_tokenization_spaces: false,
      }),
    }));

    return {
      manifest: {
        schemaVersion: DATASET_SCHEMA_VERSION,
        metric: CONTRIBUTION_METRIC,
        model: {
          id: MODEL_ID,
          dtype: MODEL_DTYPE,
          instrumentation: INSTRUMENTED_MODEL_NAME,
        },
        prompt: prompt.prompt,
        ...(prompt.systemPrompt === undefined
          ? {}
          : { systemPrompt: prompt.systemPrompt }),
        generatedText: tokenizer.decode(generatedTokenIds, {
          skip_special_tokens: true,
          clean_up_tokenization_spaces: false,
        }),
        promptTokenCount,
        tokens,
        geometry: {
          layers: LAYER_COUNT,
          queryHeads: QUERY_HEAD_COUNT,
          kvHeads: KV_HEAD_COUNT,
          headDimension: HEAD_DIMENSION,
        },
        generation: {
          method: 'greedy',
          maxNewTokens: prompt.maxNewTokens,
          stopReason,
        },
        validation: {
          logitsMaxAbsoluteError: logitsMaximumError,
          contextsMaxAbsoluteError: contextsMaximumError,
        },
      },
      layers: layerRows.map((rows, layer) => ({
        schemaVersion: DATASET_SCHEMA_VERSION,
        layer,
        metric: CONTRIBUTION_METRIC,
        rows,
      })),
    };
  } finally {
    if (outputs) disposeOutputs(outputs);
    disposeTokenizedPrompt(encoded);
  }
}
