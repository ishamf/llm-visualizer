import { describe, expect, it } from 'vitest';

import { selectPromptConfigurations, validatePrompts } from './prompts.ts';

describe('prompt validation', () => {
  it('applies the default generation limit', () => {
    expect(validatePrompts([{ id: 'safe-id', prompt: 'Hello' }])).toEqual([
      { id: 'safe-id', prompt: 'Hello', maxNewTokens: 64 },
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
      [
        { id: 'duplicate', prompt: 'One' },
        { id: 'duplicate', prompt: 'Two' },
      ],
      'Duplicate prompt ID',
    ],
  ])('rejects invalid configurations', (configurations, message) => {
    expect(() => validatePrompts(configurations)).toThrow(message);
  });
});

describe('prompt selection', () => {
  const configurations = validatePrompts([
    { id: 'first', prompt: 'First' },
    { id: 'second', prompt: 'Second' },
  ]);

  it('selects one configured dataset by ID', () => {
    expect(selectPromptConfigurations(configurations, 'second')).toEqual([
      expect.objectContaining({ id: 'second' }),
    ]);
  });

  it('keeps all datasets when no ID is supplied', () => {
    expect(selectPromptConfigurations(configurations)).toBe(configurations);
  });

  it('reports the available IDs when selection fails', () => {
    expect(() => selectPromptConfigurations(configurations, 'missing')).toThrow(
      'Unknown dataset ID "missing". Available IDs: first, second',
    );
  });
});
