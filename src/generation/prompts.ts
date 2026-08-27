import {
  DEFAULT_GENERATION_SEED,
  GENERATION_TEMPERATURE,
  GENERATION_TOP_K,
  GENERATION_TOP_P,
  MAX_GENERATED_TOKENS,
} from './config.ts';
import type {
  ContributionFormat,
  PromptConfiguration,
  ValidatedPromptConfiguration,
} from './types.ts';

export const prompts: PromptConfiguration[] = [
  {
    id: 'hello',
    prompt: 'Say hello.',
    systemPrompt: 'You are a helpful assistant.',
    maxNewTokens: 16,
  },
  {
    id: 'multiplication-place-values',
    prompt: 'Calculate 5726*37',
    assistantPrefix: '5000 * 7 = 35000\n700 * 7 = 4900\n',
    maxNewTokens: 256,
  },
  {
    id: 'fix-average-off-by-one',
    systemPrompt:
      'You are a helpful assistant. You should strive to provide a concise answer.',
    prompt: `This JavaScript function should calculate the average of its input, but it crashes with ReferenceError: array is not defined instead. Why did it happen? Can you fix it?


function arrayAverage(numbers) {
  let total = 0;
  for (let index = 0; index < array.length; index++) {
    total += array[index];
  }
  return total / array.length;
}

console.log(arrayAverage([2, 4, 6]));
`,
    assistantPrefix: `The bug is a simple naming mismatch: the function parameter is called numbers, but the body references array`,
    maxNewTokens: 1000,
    contributionFormats: ['summed'],
  },
];

const SAFE_PROMPT_ID = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
const DEFAULT_MAX_NEW_TOKENS = 64;
const DEFAULT_CONTRIBUTION_FORMATS: ContributionFormat[] = [
  'layered',
  'summed',
];

export function validatePrompts(
  configurations: PromptConfiguration[],
): ValidatedPromptConfiguration[] {
  if (configurations.length === 0) {
    throw new Error('At least one prompt must be configured');
  }

  const ids = new Set<string>();
  return configurations.map((configuration, index) => {
    if (!SAFE_PROMPT_ID.test(configuration.id)) {
      throw new Error(
        `Prompt ${index} has unsafe ID ${JSON.stringify(configuration.id)}`,
      );
    }
    if (ids.has(configuration.id)) {
      throw new Error(`Duplicate prompt ID: ${configuration.id}`);
    }
    ids.add(configuration.id);

    if (configuration.prompt.trim().length === 0) {
      throw new Error(`Prompt ${configuration.id} is empty`);
    }
    if (
      configuration.systemPrompt !== undefined &&
      configuration.systemPrompt.trim().length === 0
    ) {
      throw new Error(`Prompt ${configuration.id} has an empty system prompt`);
    }
    if (
      configuration.assistantPrefix !== undefined &&
      configuration.assistantPrefix.trim().length === 0
    ) {
      throw new Error(
        `Prompt ${configuration.id} has an empty assistant prefix`,
      );
    }

    const maxNewTokens = configuration.maxNewTokens ?? DEFAULT_MAX_NEW_TOKENS;
    if (
      !Number.isSafeInteger(maxNewTokens) ||
      maxNewTokens < 1 ||
      maxNewTokens > MAX_GENERATED_TOKENS
    ) {
      throw new Error(
        `Prompt ${configuration.id} maxNewTokens must be an integer from 1 to ${MAX_GENERATED_TOKENS}`,
      );
    }

    const contributionFormats = configuration.contributionFormats ?? [
      ...DEFAULT_CONTRIBUTION_FORMATS,
    ];
    if (
      contributionFormats.length === 0 ||
      contributionFormats.some(
        (format) => format !== 'layered' && format !== 'summed',
      ) ||
      new Set(contributionFormats).size !== contributionFormats.length
    ) {
      throw new Error(
        `Prompt ${configuration.id} contributionFormats must contain unique layered and/or summed values`,
      );
    }

    const enableThinking = configuration.enableThinking ?? false;
    if (typeof enableThinking !== 'boolean') {
      throw new Error(
        `Prompt ${configuration.id} enableThinking must be boolean`,
      );
    }
    const seed = configuration.seed ?? DEFAULT_GENERATION_SEED;
    if (!Number.isSafeInteger(seed) || seed < 0) {
      throw new Error(
        `Prompt ${configuration.id} seed must be a non-negative safe integer`,
      );
    }
    const temperature = configuration.temperature ?? GENERATION_TEMPERATURE;
    if (!Number.isFinite(temperature) || temperature <= 0) {
      throw new Error(
        `Prompt ${configuration.id} temperature must be a positive finite number`,
      );
    }
    const topK = configuration.topK ?? GENERATION_TOP_K;
    if (!Number.isSafeInteger(topK) || topK < 1) {
      throw new Error(
        `Prompt ${configuration.id} topK must be a positive safe integer`,
      );
    }
    const topP = configuration.topP ?? GENERATION_TOP_P;
    if (!Number.isFinite(topP) || topP <= 0 || topP > 1) {
      throw new Error(
        `Prompt ${configuration.id} topP must be a finite number in (0, 1]`,
      );
    }

    return {
      ...configuration,
      maxNewTokens,
      contributionFormats,
      enableThinking,
      seed,
      temperature,
      topK,
      topP,
    };
  });
}

export function selectPromptConfigurations(
  configurations: ValidatedPromptConfiguration[],
  id?: string,
  format?: ContributionFormat,
): ValidatedPromptConfiguration[] {
  const eligible =
    format === undefined
      ? configurations
      : configurations.filter((configuration) =>
          configuration.contributionFormats.includes(format),
        );
  if (id === undefined) return eligible;

  const selected = configurations.find(
    (configuration) => configuration.id === id,
  );
  if (!selected) {
    throw new Error(
      `Unknown dataset ID ${JSON.stringify(id)}. Available IDs: ${configurations.map((configuration) => configuration.id).join(', ')}`,
    );
  }
  if (format !== undefined && !selected.contributionFormats.includes(format)) {
    throw new Error(
      `Dataset ${JSON.stringify(id)} is not configured for ${format} contributions`,
    );
  }
  return [selected];
}
