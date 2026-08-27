import { random, Tensor } from '@huggingface/transformers';

import {
  CONTRIBUTION_METRIC,
  DATASET_SCHEMA_VERSION,
  GENERATION_EOS_TOKEN_IDS,
  HEAD_DIMENSION,
  INSTRUMENTED_MODEL_NAME,
  KV_HEAD_COUNT,
  LAYER_COUNT,
  MODEL_DTYPE,
  MODEL_ID,
  QUERY_HEAD_COUNT,
} from './config.ts';
import { contributionRow, contributionRows } from './attention.ts';
import {
  pastKeyInputName,
  pastValueInputName,
  presentKeyOutputName,
  presentValueOutputName,
} from './model-output-names.ts';
import type {
  CausalLanguageModel,
  ContributionDataset,
  ContributionManifest,
  ModelInputs,
  ModelOutputs,
  ModelTensor,
  NumericArray,
  SummedContributionDataset,
  Tokenizer,
  ValidatedPromptConfiguration,
} from './types.ts';
import { sampleToken } from './sampling.ts';
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
  validate?: boolean;
  originalLogits?: NumericArray;
  /** Stop at the next cooperative yield when the caller aborts a run. */
  signal?: AbortSignal;
  onProgress?: (generatedTokenCount: number) => void;
  onGeneratedToken?: (token: bigint) => void;
  /**
   * Called after a generated destination row has been summed across every
   * instrumented layer. The rows are compact: row zero explains the first
   * generated token, and so on.
   */
  onSummedContributionUpdate?: (rows: number[][]) => void;
  /** A lower-allocation variant of onSummedContributionUpdate for streams. */
  onSummedContributionRowUpdate?: (rowIndex: number, row: number[]) => void;
};

type ContributionRowsConsumer = (
  layer: number,
  firstDestination: number,
  rows: number[][],
) => void;

type GenerateContributionRunOptions = GenerateContributionDatasetOptions & {
  consumeRows: ContributionRowsConsumer;
  contributionScope: 'all' | 'generated';
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

  const rendered = tokenizer.apply_chat_template(messages, {
    tokenize: false,
    add_generation_prompt: true,
    enable_thinking: prompt.enableThinking,
  });
  if (typeof rendered !== 'string') {
    throw new Error('Chat template did not return text');
  }

  // The prefix follows the generation marker so it is part of an unfinished
  // assistant response. Encoding once preserves merges at the boundary.
  const tokenIds = tokenizer
    .encode(rendered + (prompt.assistantPrefix ?? ''), {
      add_special_tokens: false,
    })
    .map(BigInt);
  if (tokenIds.length === 0) {
    throw new Error(`Prompt ${prompt.id} produced no tokens`);
  }
  const dimensions = [1, tokenIds.length];

  return {
    inputIds: new Tensor('int64', tokenIds, dimensions),
    attentionMask: new Tensor(
      'int64',
      Array<bigint>(tokenIds.length).fill(1n),
      dimensions,
    ),
    tokenIds,
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

export function lastLogits(logits: ModelTensor) {
  const vocabularySize = logits.dims.at(-1);
  if (!vocabularySize || logits.data.length < vocabularySize) {
    throw new Error(`Invalid logits shape [${logits.dims.join(', ')}]`);
  }
  const offset = logits.data.length - vocabularySize;
  return Float32Array.from({ length: vocabularySize }, (_, index) =>
    Number(logits.data[offset + index]),
  );
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
  return [...eosTokenIds, ...GENERATION_EOS_TOKEN_IDS].some(
    (eosTokenId) => eosTokenId !== null && BigInt(eosTokenId) === token,
  );
}

function sampleLastToken(
  logits: ModelTensor,
  generator: { random: () => number },
  prompt: ValidatedPromptConfiguration,
) {
  return sampleToken(lastLogits(logits), {
    temperature: prompt.temperature,
    topK: prompt.topK,
    topP: prompt.topP,
    random: generator.random.bind(generator),
  });
}

function numericTokenId(token: bigint) {
  const id = Number(token);
  if (!Number.isSafeInteger(id)) {
    throw new Error(`Token ID ${token} cannot be represented safely in JSON`);
  }
  return id;
}

export function throwIfGenerationAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error('Generation cancelled');
  error.name = 'AbortError';
  throw error;
}

async function generateContributionRun({
  model,
  tokenizer,
  prompt,
  validate = false,
  originalLogits,
  signal,
  onProgress,
  onGeneratedToken,
  consumeRows,
  contributionScope,
}: GenerateContributionRunOptions): Promise<ContributionManifest> {
  const encoded = tokenizePrompt(tokenizer, prompt);
  const promptTokenCount = encoded.tokenIds.length;
  const tokenIds = [...encoded.tokenIds];
  const generatedTokenIds: bigint[] = [];
  let logitsMaximumError: number | undefined;
  let contextsMaximumError: number | undefined;
  let stopReason: 'eos' | 'max_new_tokens' = 'max_new_tokens';
  let outputs: ModelOutputs | undefined;
  const generator = new random.Random(prompt.seed);

  try {
    throwIfGenerationAborted(signal);
    outputs = await model.forward({
      input_ids: encoded.inputIds,
      attention_mask: encoded.attentionMask,
    });
    throwIfGenerationAborted(signal);
    if (validate) {
      if (!originalLogits) {
        throw new Error('Validation requires original model logits');
      }
      const logitStats = validateLogits(
        lastLogits(outputs.logits),
        originalLogits,
      );
      logitsMaximumError = logitStats.maxAbsoluteError;
      contextsMaximumError = validateModelStep(outputs).maxAbsoluteError;
    }
    for (let layer = 0; layer < LAYER_COUNT; ++layer) {
      throwIfGenerationAborted(signal);
      if (contributionScope === 'all') {
        consumeRows(layer, 0, contributionRows(outputs, layer));
      } else {
        consumeRows(layer, promptTokenCount - 1, [
          contributionRow(outputs, layer, promptTokenCount - 1),
        ]);
      }
      if (onProgress) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    let nextToken = sampleLastToken(outputs.logits, generator, prompt);
    for (let step = 0; step < prompt.maxNewTokens; ++step) {
      throwIfGenerationAborted(signal);
      tokenIds.push(nextToken);
      generatedTokenIds.push(nextToken);
      onGeneratedToken?.(nextToken);
      onProgress?.(generatedTokenIds.length);

      const reachedEos = isEosToken(tokenizer, nextToken);
      const reachedLimit = step + 1 >= prompt.maxNewTokens;
      if (contributionScope === 'generated' && (reachedEos || reachedLimit)) {
        if (reachedEos) stopReason = 'eos';
        break;
      }

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
      throwIfGenerationAborted(signal);

      if (validate) {
        const decodeStats = validateModelStep(outputs);
        contextsMaximumError = Math.max(
          contextsMaximumError ?? 0,
          decodeStats.maxAbsoluteError,
        );
      }
      for (let layer = 0; layer < LAYER_COUNT; ++layer) {
        throwIfGenerationAborted(signal);
        const destination = tokenIds.length - 1;
        consumeRows(layer, destination, contributionRows(outputs, layer));
        if (onProgress) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }

      if (reachedEos) {
        stopReason = 'eos';
        break;
      }
      if (!reachedLimit) {
        nextToken = sampleLastToken(outputs.logits, generator, prompt);
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
      ...(prompt.assistantPrefix === undefined
        ? {}
        : { assistantPrefix: prompt.assistantPrefix }),
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
        method: 'sampling',
        maxNewTokens: prompt.maxNewTokens,
        stopReason,
        enableThinking: prompt.enableThinking,
        seed: prompt.seed,
        temperature: prompt.temperature,
        topK: prompt.topK,
        topP: prompt.topP,
      },
      ...(logitsMaximumError === undefined || contextsMaximumError === undefined
        ? {}
        : {
            validation: {
              logitsMaxAbsoluteError: logitsMaximumError,
              contextsMaxAbsoluteError: contextsMaximumError,
            },
          }),
    };
  } finally {
    if (outputs) disposeOutputs(outputs);
    disposeTokenizedPrompt(encoded);
  }
}

export async function generateContributionDataset(
  options: GenerateContributionDatasetOptions,
): Promise<ContributionDataset> {
  const layerRows = Array.from({ length: LAYER_COUNT }, () => [] as number[][]);
  const manifest = await generateContributionRun({
    ...options,
    consumeRows(layer, firstDestination, rows) {
      if (layerRows[layer].length !== firstDestination) {
        throw new Error(
          `Layer ${layer} received contribution row ${firstDestination} out of order`,
        );
      }
      layerRows[layer].push(...rows);
    },
    contributionScope: 'all',
  });
  return {
    manifest,
    layers: layerRows.map((rows, layer) => ({
      schemaVersion: DATASET_SCHEMA_VERSION,
      layer,
      metric: CONTRIBUTION_METRIC,
      rows,
    })),
  };
}

export function addSummedContributionRows(
  totals: number[][],
  firstDestination: number,
  incomingRows: number[][],
) {
  for (const [offset, incoming] of incomingRows.entries()) {
    const destination = firstDestination + offset;
    const total = totals[destination];
    if (total === undefined) {
      totals[destination] = [...incoming];
    } else {
      if (total.length !== incoming.length) {
        throw new Error(`Contribution row ${destination} changed causal shape`);
      }
      for (let source = 0; source < incoming.length; ++source) {
        total[source] += incoming[source];
      }
    }
  }
}

export async function generateSummedContributionDataset(
  options: GenerateContributionDatasetOptions,
): Promise<SummedContributionDataset> {
  const rows: number[][] = [];
  let firstContributionDestination: number | undefined;
  let emittedRowCount = 0;
  const manifest = await generateContributionRun({
    ...options,
    consumeRows(_layer, firstDestination, incomingRows) {
      firstContributionDestination ??= firstDestination;
      addSummedContributionRows(
        rows,
        firstDestination - firstContributionDestination,
        incomingRows,
      );
      // A destination is delivered one layer at a time. Waiting until the
      // final layer avoids posting the same large partial matrix 28 times and
      // gives consumers a complete row for each streamed token.
      if (_layer === LAYER_COUNT - 1) {
        options.onSummedContributionUpdate?.(rows.map((row) => [...row]));
        while (emittedRowCount < rows.length) {
          options.onSummedContributionRowUpdate?.(emittedRowCount, [
            ...rows[emittedRowCount],
          ]);
          emittedRowCount += 1;
        }
      }
    },
    contributionScope: 'generated',
  });
  return {
    manifest,
    contributions: {
      schemaVersion: DATASET_SCHEMA_VERSION,
      metric: CONTRIBUTION_METRIC,
      aggregation: 'sum',
      layerCount: LAYER_COUNT,
      targetTokenStart: manifest.promptTokenCount,
      rows,
    },
  };
}
