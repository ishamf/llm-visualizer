import process from 'node:process';
import path from 'node:path';

import {
  AutoModelForCausalLM,
  AutoTokenizer,
  env,
} from '@huggingface/transformers';

import {
  INSTRUMENTED_MODEL_NAME,
  MODEL_DTYPE,
  MODEL_ID,
  MODEL_ROOT,
} from '../generation/config.ts';
import { writeContributionDataset } from '../generation/dataset.ts';
import {
  disposeOutputs,
  disposeTokenizedPrompt,
  generateContributionDataset,
  tokenizePrompt,
} from '../generation/generate.ts';
import { prompts, validatePrompts } from '../generation/prompts.ts';
import type {
  CausalLanguageModel,
  ModelOutputs,
  Tokenizer,
} from '../generation/types.ts';

type CommandLineOptions = {
  outputRoot: string;
  overwrite: boolean;
};

function parseArguments(arguments_: string[]): CommandLineOptions {
  let outputRoot = path.resolve('generated/contributions');
  let overwrite = false;
  for (let index = 0; index < arguments_.length; ++index) {
    const argument = arguments_[index];
    if (argument === '--') {
      continue;
    } else if (argument === '--overwrite') {
      overwrite = true;
    } else if (argument === '--output') {
      const value = arguments_[++index];
      if (!value) throw new Error('--output requires a directory');
      outputRoot = path.resolve(value);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { outputRoot, overwrite };
}

async function originalPromptLogits(
  tokenizer: Tokenizer,
  configurations: ReturnType<typeof validatePrompts>,
) {
  console.error(`Loading original ${MODEL_ID} for logits validation...`);
  const original = (await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
    dtype: MODEL_DTYPE,
    local_files_only: true,
  })) as unknown as CausalLanguageModel;
  const logits = new Map<string, Float32Array>();
  try {
    for (const prompt of configurations) {
      const encoded = tokenizePrompt(tokenizer, prompt);
      let outputs: ModelOutputs | undefined;
      try {
        outputs = await original.forward({
          input_ids: encoded.inputIds,
          attention_mask: encoded.attentionMask,
        });
        logits.set(prompt.id, Float32Array.from(outputs.logits.data, Number));
      } finally {
        if (outputs) disposeOutputs(outputs);
        disposeTokenizedPrompt(encoded);
      }
    }
  } finally {
    await original.dispose();
  }
  return logits;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  // Prompt validation deliberately happens before any model is loaded.
  const configurations = validatePrompts(prompts);

  env.localModelPath = MODEL_ROOT;
  env.allowRemoteModels = false;
  const tokenizer = (await AutoTokenizer.from_pretrained(MODEL_ID, {
    local_files_only: true,
  })) as unknown as Tokenizer;
  const expectedLogits = await originalPromptLogits(tokenizer, configurations);

  console.error(`Loading instrumented ${MODEL_ID}...`);
  const model = (await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
    dtype: MODEL_DTYPE,
    local_files_only: true,
    model_file_name: INSTRUMENTED_MODEL_NAME,
  })) as unknown as CausalLanguageModel;

  try {
    for (const prompt of configurations) {
      console.error(
        `Generating ${prompt.id} (up to ${prompt.maxNewTokens} new tokens)...`,
      );
      const originalLogits = expectedLogits.get(prompt.id);
      if (!originalLogits) {
        throw new Error(`Missing original logits for prompt ${prompt.id}`);
      }
      const dataset = await generateContributionDataset({
        model,
        tokenizer,
        prompt,
        originalLogits,
      });
      const destination = await writeContributionDataset(
        options.outputRoot,
        prompt.id,
        dataset,
        options.overwrite,
      );
      console.error(
        `Wrote ${dataset.manifest.tokens.length} tokens across ${dataset.layers.length} layers to ${destination}`,
      );
    }
  } finally {
    await model.dispose();
  }
}

await main();
