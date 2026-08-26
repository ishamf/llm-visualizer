import { MAX_GENERATED_TOKENS } from './config.ts';
import type {
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
];

const SAFE_PROMPT_ID = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
const DEFAULT_MAX_NEW_TOKENS = 64;

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

    return { ...configuration, maxNewTokens };
  });
}
