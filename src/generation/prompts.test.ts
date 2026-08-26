import { describe, expect, it } from 'vitest';

import { selectPromptConfigurations, validatePrompts } from './prompts.ts';
import type { PromptConfiguration } from './types.ts';

describe('prompt validation', () => {
  it('applies the default generation limit', () => {
    expect(validatePrompts([{ id: 'safe-id', prompt: 'Hello' }])).toEqual([
      {
        id: 'safe-id',
        prompt: 'Hello',
        maxNewTokens: 64,
        contributionFormats: ['layered', 'summed'],
      },
    ]);
  });

  it.each([
    [[{ id: '../unsafe', prompt: 'Hello' }], 'unsafe ID'],
    [[{ id: 'empty', prompt: '  ' }], 'is empty'],
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
