import { describe, expect, it } from 'vitest';

import {
  browserModelProfile,
  browserModelWeightsPath,
  DEFAULT_BROWSER_MODEL_SELECTION,
} from './config.ts';

describe('browser model selection', () => {
  it('defaults to the smaller CPU int8 model', () => {
    expect(DEFAULT_BROWSER_MODEL_SELECTION).toEqual({
      modelKey: 'qwen3-0.6b',
      device: 'cpu',
      dtype: 'int8',
    });
  });

  it('resolves the selected model and artifact', () => {
    const selection = {
      modelKey: 'qwen3-1.7b',
      device: 'cpu',
      dtype: 'int8',
    } as const;

    expect(browserModelProfile(selection).id).toBe('Qwen3-1.7B-ONNX');
    expect(browserModelWeightsPath(selection)).toBe(
      '/models/Qwen3-1.7B-ONNX/onnx/instrumented_int8.onnx',
    );
  });

  it('rejects variants unsupported by the selected runtime', () => {
    expect(() =>
      browserModelProfile({
        modelKey: 'qwen3-0.6b',
        device: 'cpu',
        dtype: 'q4f16',
      }),
    ).toThrow('CPU does not support the q4f16 model variant');
  });

  it('uses q4f16 for WebGPU generation', () => {
    expect(
      browserModelProfile({
        modelKey: 'qwen3-0.6b',
        device: 'webgpu',
        dtype: 'q4f16',
      }).dtype,
    ).toBe('q4f16');
  });
});
