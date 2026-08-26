import process from 'node:process';

import {
  AutoModelForCausalLM,
  AutoTokenizer,
  env,
  Tensor,
} from '@huggingface/transformers';

import { contributionRows } from '../generation/attention.ts';
import {
  CONTEXT_ABSOLUTE_TOLERANCE,
  INSTRUMENTED_MODEL_NAME,
  LAYER_COUNT,
  MODEL_DTYPE,
  MODEL_ID,
  MODEL_ROOT,
} from '../generation/config.ts';
import {
  argmaxLastLogit,
  disposeOutputs,
  disposeTokenizedPrompt,
  pastKeyValues,
  tokenizePrompt,
} from '../generation/generate.ts';
import type {
  CausalLanguageModel,
  ModelOutputs,
  Tokenizer,
  ValidationStats,
} from '../generation/types.ts';
import { validateLogits, validateModelStep } from '../generation/validation.ts';

function oneTokenTensor(token: bigint) {
  return new Tensor('int64', [token], [1, 1]);
}

function attentionMask(length: number) {
  return new Tensor('int64', Array<bigint>(length).fill(1n), [1, length]);
}

function displayToken(tokenizer: Tokenizer, token: bigint) {
  return JSON.stringify(
    tokenizer.decode([token], {
      skip_special_tokens: false,
      clean_up_tokenization_spaces: false,
    }),
  );
}

function printStrongestContribution(
  tokenizer: Tokenizer,
  tokenIds: bigint[],
  destinationIndex: number,
  row: number[],
) {
  let sourceIndex: number | undefined;
  let magnitude = -Infinity;
  for (let source = 0; source < row.length; ++source) {
    if (source !== destinationIndex && row[source] > magnitude) {
      sourceIndex = source;
      magnitude = row[source];
    }
  }
  const destination = displayToken(tokenizer, tokenIds[destinationIndex]);
  const source =
    sourceIndex === undefined
      ? '[none]'
      : `[${sourceIndex} ${displayToken(tokenizer, tokenIds[sourceIndex])}]`;
  console.log(
    `${destinationIndex} ${destination} ${sourceIndex === undefined ? '0.000000' : magnitude.toFixed(6)} <- ${source}`,
  );
}

function logStats(label: string, stats: ValidationStats) {
  console.error(
    `${label}: max abs ${stats.maxAbsoluteError.toExponential(3)}, mean abs ${stats.meanAbsoluteError.toExponential(3)}`,
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
  const tokenizer = (await AutoTokenizer.from_pretrained(MODEL_ID, {
    local_files_only: true,
  })) as unknown as Tokenizer;
  const encoded = tokenizePrompt(tokenizer, {
    id: 'validation',
    prompt,
    systemPrompt: 'You are a helpful assistant.',
    maxNewTokens: Math.max(1, maxNewTokens),
    contributionFormats: ['layered', 'summed'],
  });
  const tokenIds = [...encoded.tokenIds];

  console.error(
    'Checking that instrumentation does not change prompt logits...',
  );
  const original = (await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
    dtype: MODEL_DTYPE,
    local_files_only: true,
  })) as unknown as CausalLanguageModel;
  let originalOutputs: ModelOutputs | undefined;
  let originalLogits: Float32Array;
  try {
    originalOutputs = await original.forward({
      input_ids: encoded.inputIds,
      attention_mask: encoded.attentionMask,
    });
    originalLogits = Float32Array.from(originalOutputs.logits.data, Number);
  } finally {
    if (originalOutputs) disposeOutputs(originalOutputs);
    await original.dispose();
  }

  const model = (await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
    dtype: MODEL_DTYPE,
    local_files_only: true,
    model_file_name: INSTRUMENTED_MODEL_NAME,
  })) as unknown as CausalLanguageModel;

  let outputs: ModelOutputs | undefined;
  try {
    outputs = await model.forward({
      input_ids: encoded.inputIds,
      attention_mask: encoded.attentionMask,
    });
    logStats('logits', validateLogits(outputs.logits.data, originalLogits));
    const prefillStats = validateModelStep(outputs);
    logStats('prefill contexts', prefillStats);
    let worstContextError = prefillStats.maxAbsoluteError;

    console.log('\nindex token contribution <- [source index token]');
    for (const [index, row] of contributionRows(
      outputs,
      LAYER_COUNT - 1,
    ).entries()) {
      printStrongestContribution(tokenizer, tokenIds, index, row);
    }

    let nextToken = argmaxLastLogit(outputs.logits);
    for (let step = 0; step < maxNewTokens; ++step) {
      tokenIds.push(nextToken);
      const inputIds = oneTokenTensor(nextToken);
      const mask = attentionMask(tokenIds.length);
      const previousOutputs = outputs;
      try {
        outputs = await model.forward({
          input_ids: inputIds,
          attention_mask: mask,
          past_key_values: pastKeyValues(previousOutputs),
        });
      } finally {
        inputIds.dispose();
        mask.dispose();
      }
      disposeOutputs(previousOutputs);

      const stats = validateModelStep(outputs);
      worstContextError = Math.max(worstContextError, stats.maxAbsoluteError);
      const destination = tokenIds.length - 1;
      printStrongestContribution(
        tokenizer,
        tokenIds,
        destination,
        contributionRows(outputs, LAYER_COUNT - 1)[0],
      );

      const eosIds = Array.isArray(tokenizer.eos_token_id)
        ? tokenizer.eos_token_id
        : [tokenizer.eos_token_id];
      if (eosIds.some((id) => id !== null && BigInt(id) === nextToken)) break;
      nextToken = argmaxLastLogit(outputs.logits);
    }
    console.error(
      `prefill + decode contexts: worst max abs ${worstContextError.toExponential(3)} (tolerance ${CONTEXT_ABSOLUTE_TOLERANCE})`,
    );
  } finally {
    if (outputs) disposeOutputs(outputs);
    disposeTokenizedPrompt(encoded);
    await model.dispose();
  }
}

await main();
