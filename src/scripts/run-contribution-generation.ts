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
import {
  disposeOutputs,
  disposeTokenizedPrompt,
  lastLogits,
  tokenizePrompt,
  type GenerateContributionDatasetOptions,
} from '../generation/generate.ts';
import {
  prompts,
  selectPromptConfigurations,
  validatePrompts,
} from '../generation/prompts.ts';
import type {
  CausalLanguageModel,
  ContributionFormat,
  ContributionManifest,
  ModelOutputs,
  Tokenizer,
} from '../generation/types.ts';

type CommandLineOptions = {
  datasetId?: string;
  outputRoot: string;
  overwrite: boolean;
  validate: boolean;
};

type ContributionGenerationTarget<
  Dataset extends { manifest: ContributionManifest },
> = {
  format: ContributionFormat;
  defaultOutputRoot: string;
  noun: string;
  generate: (options: GenerateContributionDatasetOptions) => Promise<Dataset>;
  write: (
    outputRoot: string,
    datasetId: string,
    dataset: Dataset,
    overwrite: boolean,
  ) => Promise<string>;
  outputDescription: (dataset: Dataset) => string;
};

function parseArguments(
  arguments_: string[],
  defaultOutputRoot: string,
): CommandLineOptions {
  let datasetId: string | undefined;
  let outputRoot = path.resolve(defaultOutputRoot);
  let overwrite = false;
  let validate = false;
  for (let index = 0; index < arguments_.length; ++index) {
    const argument = arguments_[index];
    if (argument === '--') {
      continue;
    } else if (argument === '--id') {
      const value = arguments_[++index];
      if (!value || value.startsWith('--')) {
        throw new Error('--id requires a dataset ID');
      }
      if (datasetId !== undefined) {
        throw new Error('--id may only be provided once');
      }
      datasetId = value;
    } else if (argument === '--overwrite') {
      overwrite = true;
    } else if (argument === '--validate') {
      validate = true;
    } else if (argument === '--output') {
      const value = arguments_[++index];
      if (!value) throw new Error('--output requires a directory');
      outputRoot = path.resolve(value);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { datasetId, outputRoot, overwrite, validate };
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
        logits.set(prompt.id, lastLogits(outputs.logits));
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

export async function runContributionGeneration<
  Dataset extends { manifest: ContributionManifest },
>(arguments_: string[], target: ContributionGenerationTarget<Dataset>) {
  const options = parseArguments(arguments_, target.defaultOutputRoot);
  // Validation and format filtering deliberately happen before model loading.
  const configurations = selectPromptConfigurations(
    validatePrompts(prompts),
    options.datasetId,
    target.format,
  );
  if (configurations.length === 0) {
    console.error(
      `No prompts are configured for ${target.format} contributions; nothing to generate.`,
    );
    return;
  }

  env.localModelPath = MODEL_ROOT;
  env.allowRemoteModels = false;
  const tokenizer = (await AutoTokenizer.from_pretrained(MODEL_ID, {
    local_files_only: true,
  })) as unknown as Tokenizer;
  const expectedLogits = options.validate
    ? await originalPromptLogits(tokenizer, configurations)
    : undefined;

  console.error(`Loading instrumented ${MODEL_ID}...`);
  const model = (await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
    dtype: MODEL_DTYPE,
    local_files_only: true,
    model_file_name: INSTRUMENTED_MODEL_NAME,
  })) as unknown as CausalLanguageModel;

  try {
    for (const prompt of configurations) {
      console.error(
        `Generating ${target.noun} ${prompt.id} (up to ${prompt.maxNewTokens} new tokens)...`,
      );
      const originalLogits = expectedLogits?.get(prompt.id);
      if (options.validate && !originalLogits) {
        throw new Error(`Missing original logits for prompt ${prompt.id}`);
      }
      const dataset = await target.generate({
        model,
        tokenizer,
        prompt,
        validate: options.validate,
        originalLogits,
      });
      const destination = await target.write(
        options.outputRoot,
        prompt.id,
        dataset,
        options.overwrite,
      );
      console.error(
        `Wrote ${dataset.manifest.tokens.length} tokens ${target.outputDescription(dataset)} to ${destination}`,
      );
    }
  } finally {
    await model.dispose();
  }
}
