import { describe, expect, it } from 'vitest';

import { sampleToken } from './sampling.ts';

describe('token sampling', () => {
  it('applies top-k before sampling', () => {
    expect(
      sampleToken([2, 2, 1, 0], {
        temperature: 1,
        topK: 2,
        topP: 1,
        random: () => 0.999,
      }),
    ).toBe(1n);
  });

  it('applies nucleus filtering within the top-k candidates', () => {
    expect(
      sampleToken([4, 3, 2], {
        temperature: 1,
        topK: 3,
        topP: 0.6,
        random: () => 0.999,
      }),
    ).toBe(0n);
  });

  it('uses the supplied random source reproducibly', () => {
    const options = {
      temperature: 1,
      topK: 2,
      topP: 1,
      random: () => 0,
    };
    expect(sampleToken([1, 2], options)).toBe(1n);
    expect(sampleToken([1, 2], options)).toBe(1n);
  });
});
