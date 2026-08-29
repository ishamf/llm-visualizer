import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AutoModelForCausalLM,
  AutoTokenizer,
  env,
  TextStreamer,
} from '@huggingface/transformers';

import {
  DEFAULT_EXPORT_MODEL_KEY,
  MODEL_PROFILES,
  parseModelKey,
  type ModelKey,
  type ModelProfile,
} from '../generation/config.ts';
import {
  assertDatasetDestinationAvailable,
  datasetDestinationExists,
} from '../generation/atomic-dataset.ts';
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
  ValidatedPromptConfiguration,
} from '../generation/types.ts';

const MODEL_ROOT = fileURLToPath(new URL('../../models/', import.meta.url));

type CommandLineOptions = {
  datasetId?: string;
  modelKey: ModelKey;
  outputRoot: string;
  overwrite: boolean;
  stream: boolean;
  validate: boolean;
};

type ContributionGenerationTarget<
  Dataset extends { manifest: ContributionManifest },
> = {
  format: ContributionFormat;
  defaultOutputRoot: string;
  noun: string;
  showProgress?: boolean;
  generate: (options: GenerateContributionDatasetOptions) => Promise<Dataset>;
  write: (
    outputRoot: string,
    datasetId: string,
    dataset: Dataset,
    overwrite: boolean,
  ) => Promise<string>;
  outputDescription: (dataset: Dataset) => string;
};

export function parseArguments(
  arguments_: string[],
  defaultOutputRoot: string,
): CommandLineOptions {
  let datasetId: string | undefined;
  let modelKey = DEFAULT_EXPORT_MODEL_KEY;
  let outputRoot = path.resolve(defaultOutputRoot);
  let overwrite = false;
  let stream = true;
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
    } else if (argument === '--model') {
      const value = arguments_[++index];
      if (!value || value.startsWith('--')) {
        throw new Error('--model requires a model name');
      }
      modelKey = parseModelKey(value);
    } else if (argument === '--no-stream') {
      stream = false;
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
  return { datasetId, modelKey, outputRoot, overwrite, stream, validate };
}

export function modelOutputRoot(outputRoot: string, profile: ModelProfile) {
  return path.join(outputRoot, profile.key);
}

export async function partitionExistingPromptConfigurations(
  configurations: ValidatedPromptConfiguration[],
  outputRoot: string,
) {
  const existence = await Promise.all(
    configurations.map((prompt) =>
      datasetDestinationExists(outputRoot, prompt.id),
    ),
  );
  return configurations.reduce<{
    pending: ValidatedPromptConfiguration[];
    skipped: ValidatedPromptConfiguration[];
  }>(
    (partition, prompt, index) => {
      partition[existence[index] ? 'skipped' : 'pending'].push(prompt);
      return partition;
    },
    { pending: [], skipped: [] },
  );
}

async function originalPromptLogits(
  modelProfile: ModelProfile,
  tokenizer: Tokenizer,
  configurations: ReturnType<typeof validatePrompts>,
) {
  console.error(`Loading original ${modelProfile.id} for logits validation...`);
  const original = (await AutoModelForCausalLM.from_pretrained(
    modelProfile.id,
    {
      dtype: modelProfile.dtype,
      local_files_only: true,
    },
  )) as unknown as CausalLanguageModel;
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
  const modelProfile = MODEL_PROFILES[options.modelKey];
  const scopedOutputRoot = modelOutputRoot(options.outputRoot, modelProfile);
  // Validation and format filtering deliberately happen before model loading.
  let configurations = selectPromptConfigurations(
    validatePrompts(prompts, modelProfile.generation),
    options.datasetId,
    target.format,
  );
  if (configurations.length === 0) {
    console.error(
      `No prompts are configured for ${target.format} contributions; nothing to generate.`,
    );
    return;
  }
  if (options.datasetId === undefined && !options.overwrite) {
    const { pending, skipped } = await partitionExistingPromptConfigurations(
      configurations,
      scopedOutputRoot,
    );
    for (const prompt of skipped) {
      console.error(`Skipping existing dataset ${prompt.id}.`);
    }
    configurations = pending;
    if (configurations.length === 0) {
      console.error(
        'All configured datasets already exist; nothing to generate.',
      );
      return;
    }
  } else {
    await Promise.all(
      configurations.map((prompt) =>
        assertDatasetDestinationAvailable(
          scopedOutputRoot,
          prompt.id,
          options.overwrite,
        ),
      ),
    );
  }

  env.localModelPath = MODEL_ROOT;
  env.allowRemoteModels = false;
  const tokenizer = (await AutoTokenizer.from_pretrained(modelProfile.id, {
    local_files_only: true,
  })) as unknown as Tokenizer;
  const expectedLogits = options.validate
    ? await originalPromptLogits(modelProfile, tokenizer, configurations)
    : undefined;

  console.error(`Loading instrumented ${modelProfile.id}...`);
  const model = (await AutoModelForCausalLM.from_pretrained(modelProfile.id, {
    dtype: modelProfile.dtype,
    local_files_only: true,
    model_file_name: modelProfile.instrumentation,
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
      let generatedTokenCount = 0;
      const startedAt = Date.now();
      const reportProgress = () => {
        const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
        const message = `Generated ${generatedTokenCount}/${prompt.maxNewTokens} tokens · ${elapsedSeconds}s`;
        if (process.stderr.isTTY) {
          process.stderr.write(`\r${message}`);
        } else {
          console.error(message);
        }
      };
      const progressTimer = target.showProgress
        ? setInterval(reportProgress, 1_000)
        : undefined;
      const streamer = options.stream
        ? new TextStreamer(tokenizer as never, {
            skip_special_tokens: true,
            decode_kwargs: { clean_up_tokenization_spaces: false },
            callback_function: (text) => process.stdout.write(text),
          })
        : undefined;
      if (streamer) {
        process.stdout.write(`Generated text (${prompt.id}):\n`);
      }
      let dataset: Dataset;
      try {
        dataset = await target.generate({
          modelProfile,
          model,
          tokenizer,
          prompt,
          validate: options.validate,
          originalLogits,
          onProgress: target.showProgress
            ? (count) => {
                generatedTokenCount = count;
              }
            : undefined,
          onGeneratedToken: streamer
            ? (token) => streamer.put([[token]])
            : undefined,
        });
      } finally {
        if (streamer) {
          streamer.end();
          process.stdout.write('\n');
        }
        if (progressTimer) {
          clearInterval(progressTimer);
          reportProgress();
          if (process.stderr.isTTY) process.stderr.write('\n');
        }
      }
      const destination = await target.write(
        scopedOutputRoot,
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
