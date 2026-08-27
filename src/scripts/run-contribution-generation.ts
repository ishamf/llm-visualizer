import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AutoModelForCausalLM,
  AutoTokenizer,
  env,
  TextStreamer,
} from '@huggingface/transformers';

import {
  INSTRUMENTED_MODEL_NAME,
  MODEL_DTYPE,
  MODEL_ID,
} from '../generation/config.ts';
import { assertDatasetDestinationAvailable } from '../generation/atomic-dataset.ts';
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

const MODEL_ROOT = fileURLToPath(new URL('../../models/', import.meta.url));

type CommandLineOptions = {
  datasetId?: string;
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
  return { datasetId, outputRoot, overwrite, stream, validate };
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
  await Promise.all(
    configurations.map((prompt) =>
      assertDatasetDestinationAvailable(
        options.outputRoot,
        prompt.id,
        options.overwrite,
      ),
    ),
  );

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
