import { describe, expect, it } from 'vitest';

import { DEFAULT_PROMPT_ID, selectDefaultPromptId } from './homepage-state.ts';

describe('homepage prompt selection', () => {
  it('selects the configured default when it is bundled', () => {
    expect(selectDefaultPromptId(['hello', DEFAULT_PROMPT_ID])).toBe(
      DEFAULT_PROMPT_ID,
    );
  });

  it('falls back to the first bundled prompt', () => {
    expect(selectDefaultPromptId(['hello', 'extract-contact'])).toBe('hello');
  });

  it('handles a build without bundled prompts', () => {
    expect(selectDefaultPromptId([])).toBe('');
  });
});
