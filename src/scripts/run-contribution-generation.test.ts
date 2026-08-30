import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { getModelProfile } from '../generation/config.ts';
import { validatePrompts } from '../generation/prompts.ts';
import {
  modelOutputRoot,
  parseArguments,
  partitionExistingPromptConfigurations,
} from './run-contribution-generation.ts';

describe('contribution generation arguments', () => {
  it('uses the 0.6B exporter profile by default', () => {
    expect(parseArguments([], 'generated/test').modelKey).toBe('qwen3-0.6b');
    expect(parseArguments([], 'generated/test').modelVariant).toBe('int8');
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

  it('selects a model variant', () => {
    expect(
      parseArguments(['--variant', 'uint8'], 'generated/test').modelVariant,
    ).toBe('uint8');
  });

  it('scopes generated output by model key and variant', () => {
    expect(
      modelOutputRoot(
        '/tmp/generated/contributions',
        getModelProfile('qwen3-1.7b', 'int8'),
      ),
    ).toBe('/tmp/generated/contributions/qwen3-1.7b/int8');
  });

  it('streams generated text by default', () => {
    expect(parseArguments([], 'generated/test').stream).toBe(true);
  });

  it('can suppress generated text streaming', () => {
    expect(parseArguments(['--no-stream'], 'generated/test').stream).toBe(
      false,
    );
  });

  it('partitions existing destinations out of a batch run', async () => {
    const outputRoot = await mkdtemp(
      path.join(tmpdir(), 'contribution-generation-test-'),
    );
    try {
      await mkdir(path.join(outputRoot, 'second'));
      const configurations = validatePrompts([
        { id: 'first', prompt: 'First' },
        { id: 'second', prompt: 'Second' },
      ]);

      const partition = await partitionExistingPromptConfigurations(
        configurations,
        outputRoot,
      );

      expect(partition.pending.map(({ id }) => id)).toEqual(['first']);
      expect(partition.skipped.map(({ id }) => id)).toEqual(['second']);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});
