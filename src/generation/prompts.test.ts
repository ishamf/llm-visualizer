import { describe, expect, it } from 'vitest';

import { validatePrompts } from './prompts.ts';

describe('prompt validation', () => {
  it('applies the default generation limit', () => {
    expect(validatePrompts([{ id: 'safe-id', prompt: 'Hello' }])).toEqual([
      { id: 'safe-id', prompt: 'Hello', maxNewTokens: 64 },
    ]);
  });

  it.each([
    [[{ id: '../unsafe', prompt: 'Hello' }], 'unsafe ID'],
    [[{ id: 'empty', prompt: '  ' }], 'is empty'],
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
