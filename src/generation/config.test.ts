import { describe, expect, it } from 'vitest';

import {
  BROWSER_MODEL_SOURCE,
  BROWSER_MODEL_PATH,
  BROWSER_MODEL_PROFILE,
  BROWSER_MODEL_WEIGHTS_PATH,
  getBrowserModelUrls,
} from './browser-config.ts';

describe('browser model configuration', () => {
  it('keeps the Vite development model source local', () => {
    expect(BROWSER_MODEL_SOURCE).toEqual({
      type: 'local',
      baseUrl: '/models/',
    });
  });

  it('pins browser generation to the 0.6B INT8 model', () => {
    expect(BROWSER_MODEL_PROFILE).toMatchObject({
      key: 'qwen3-0.6b',
      id: 'Qwen3-0.6B-ONNX',
      dtype: 'int8',
    });
    expect(BROWSER_MODEL_PATH).toBe('/models/Qwen3-0.6B-ONNX');
    expect(BROWSER_MODEL_WEIGHTS_PATH).toBe(
      '/models/Qwen3-0.6B-ONNX/onnx/instrumented_int8.onnx',
    );
  });

  it('resolves browser model files from a configurable base URL', () => {
    expect(
      getBrowserModelUrls(
        { type: 'local', baseUrl: '../model-assets' },
        'https://example.com/demo/page',
      ),
    ).toEqual({
      root: 'https://example.com/model-assets/',
      weights:
        'https://example.com/model-assets/Qwen3-0.6B-ONNX/onnx/instrumented_int8.onnx',
    });
  });

  it('resolves model files from a pinned Hugging Face revision', () => {
    expect(
      getBrowserModelUrls(
        {
          type: 'hugging-face',
          repoId: 'example/instrumented-qwen',
          revision: 'abc123',
        },
        'https://example.com/demo/page',
      ),
    ).toEqual({
      root: 'https://huggingface.co/example/instrumented-qwen/resolve/abc123/',
      weights:
        'https://huggingface.co/example/instrumented-qwen/resolve/abc123/onnx/instrumented_int8.onnx',
    });
  });
});
