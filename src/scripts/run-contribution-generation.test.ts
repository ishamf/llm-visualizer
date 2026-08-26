import { describe, expect, it } from 'vitest';

import { parseArguments } from './run-contribution-generation.ts';

describe('contribution generation arguments', () => {
  it('streams generated text by default', () => {
    expect(parseArguments([], 'generated/test').stream).toBe(true);
  });

  it('can suppress generated text streaming', () => {
    expect(parseArguments(['--no-stream'], 'generated/test').stream).toBe(
      false,
    );
  });
});
