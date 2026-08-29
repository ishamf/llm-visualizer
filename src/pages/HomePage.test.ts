import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROMPT_ID,
  homepageGenerationReducer,
  INITIAL_HOMEPAGE_GENERATION_STATE,
  selectDefaultPromptId,
} from './homepage-state.ts';

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

describe('homepage generation mode', () => {
  it('switches to custom mode when generation starts', () => {
    expect(
      homepageGenerationReducer(INITIAL_HOMEPAGE_GENERATION_STATE, {
        type: 'start',
      }),
    ).toEqual({ mode: 'custom', session: 0 });
  });

  it('returns to pre-generated mode and starts a fresh session on clear', () => {
    expect(
      homepageGenerationReducer(
        { mode: 'custom', session: 3 },
        { type: 'clear' },
      ),
    ).toEqual({ mode: 'pre-generated', session: 4 });
  });
});
