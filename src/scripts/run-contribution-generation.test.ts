import { describe, expect, it } from 'vitest';

import { MODEL_PROFILES } from '../generation/config.ts';
import {
  modelOutputRoot,
  parseArguments,
} from './run-contribution-generation.ts';

describe('contribution generation arguments', () => {
  it('uses the 0.6B exporter profile by default', () => {
    expect(parseArguments([], 'generated/test').modelKey).toBe('qwen3-0.6b');
  });

  it('selects a model using its short alias', () => {
    expect(parseArguments(['--model', '1.7b'], 'generated/test').modelKey).toBe(
      'qwen3-1.7b',
    );
  });

  it('rejects unknown models', () => {
    expect(() =>
      parseArguments(['--model', 'unknown'], 'generated/test'),
    ).toThrow('Available models: qwen3-0.6b, qwen3-1.7b');
  });

  it('scopes generated output by model key', () => {
    expect(
      modelOutputRoot(
        '/tmp/generated/contributions',
        MODEL_PROFILES['qwen3-1.7b'],
      ),
    ).toBe('/tmp/generated/contributions/qwen3-1.7b');
  });

  it('streams generated text by default', () => {
    expect(parseArguments([], 'generated/test').stream).toBe(true);
  });

  it('can suppress generated text streaming', () => {
    expect(parseArguments(['--no-stream'], 'generated/test').stream).toBe(
      false,
    );
  });
});
