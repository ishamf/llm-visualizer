import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SYSTEM_PROMPT,
  getConfiguredPromptTitle,
  selectPromptConfigurations,
  validatePrompts,
} from './prompts.ts';
import type { PromptConfiguration } from './types.ts';

describe('prompt validation', () => {
  it('applies the default generation limit', () => {
    expect(validatePrompts([{ id: 'safe-id', prompt: 'Hello' }])).toEqual([
      {
        id: 'safe-id',
        prompt: 'Hello',
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        maxNewTokens: 64,
        contributionFormats: ['layered', 'summed'],
        enableThinking: false,
        seed: 42,
        temperature: 0.7,
        topK: 20,
        topP: 0.8,
      },
    ]);
  });

  it.each([
    [[{ id: '../unsafe', prompt: 'Hello' }], 'unsafe ID'],
    [[{ id: 'empty', prompt: '  ' }], 'is empty'],
    [[{ id: 'empty-title', title: '  ', prompt: 'Hello' }], 'empty title'],
    [
      [{ id: 'empty-prefix', prompt: 'Hello', assistantPrefix: '  ' }],
      'empty assistant prefix',
    ],
    [[{ id: 'limit', prompt: 'Hello', maxNewTokens: 0 }], 'from 1 to 1000'],
    [
      [{ id: 'format', prompt: 'Hello', contributionFormats: [] }],
      'contributionFormats',
    ],
    [
      [{ id: 'thinking', prompt: 'Hello', enableThinking: 'yes' }],
      'enableThinking',
    ],
    [[{ id: 'seed', prompt: 'Hello', seed: -1 }], 'seed'],
    [[{ id: 'temperature', prompt: 'Hello', temperature: 0 }], 'temperature'],
    [[{ id: 'top-k', prompt: 'Hello', topK: 1.5 }], 'topK'],
    [[{ id: 'top-p', prompt: 'Hello', topP: 1.1 }], 'topP'],
    [
      [
        {
          id: 'format',
          prompt: 'Hello',
          contributionFormats: ['summed', 'summed'],
        },
      ],
      'contributionFormats',
    ],
    [
      [
        { id: 'duplicate', prompt: 'One' },
        { id: 'duplicate', prompt: 'Two' },
      ],
      'Duplicate prompt ID',
    ],
  ])('rejects invalid configurations', (configurations, message) => {
    expect(() =>
      validatePrompts(configurations as PromptConfiguration[]),
    ).toThrow(message);
  });

  it('preserves per-prompt sampling overrides', () => {
    expect(
      validatePrompts([
        {
          id: 'custom-sampling',
          prompt: 'Hello',
          temperature: 0.8,
          topK: 50,
          topP: 0.9,
        },
      ])[0],
    ).toMatchObject({ temperature: 0.8, topK: 50, topP: 0.9 });
  });

  it('preserves a custom system prompt', () => {
    expect(
      validatePrompts([
        {
          id: 'custom-system-prompt',
          prompt: 'Hello',
          systemPrompt: 'Respond like a pirate.',
        },
      ])[0].systemPrompt,
    ).toBe('Respond like a pirate.');
  });

  it('uses model-specific sampling defaults', () => {
    expect(
      validatePrompts([{ id: 'profile-defaults', prompt: 'Hello' }], {
        maxGeneratedTokens: 512,
        seed: 7,
        temperature: 0.7,
        topK: 40,
        topP: 0.9,
      })[0],
    ).toMatchObject({ seed: 7, temperature: 0.7, topK: 40, topP: 0.9 });
  });
});

describe('prompt selection', () => {
  const configurations = validatePrompts([
    { id: 'first', prompt: 'First' },
    {
      id: 'second',
      prompt: 'Second',
      contributionFormats: ['summed'],
    },
  ]);

  it('selects one configured dataset by ID', () => {
    expect(selectPromptConfigurations(configurations, 'second')).toEqual([
      expect.objectContaining({ id: 'second' }),
    ]);
  });

  it('keeps all datasets when no ID is supplied', () => {
    expect(selectPromptConfigurations(configurations)).toBe(configurations);
  });

  it('filters automatic runs by contribution format', () => {
    expect(
      selectPromptConfigurations(configurations, undefined, 'layered').map(
        ({ id }) => id,
      ),
    ).toEqual(['first']);
    expect(
      selectPromptConfigurations(configurations, undefined, 'summed').map(
        ({ id }) => id,
      ),
    ).toEqual(['first', 'second']);
  });

  it('rejects an explicitly selected incompatible format', () => {
    expect(() =>
      selectPromptConfigurations(configurations, 'second', 'layered'),
    ).toThrow('not configured for layered contributions');
  });

  it('reports the available IDs when selection fails', () => {
    expect(() => selectPromptConfigurations(configurations, 'missing')).toThrow(
      'Unknown dataset ID "missing". Available IDs: first, second',
    );
  });
});

describe('prompt titles', () => {
  it('looks up configured titles without inventing one for unknown prompts', () => {
    expect(getConfiguredPromptTitle('hello')).toBe('A Friendly Hello');
    expect(getConfiguredPromptTitle('missing')).toBeUndefined();
  });
});
