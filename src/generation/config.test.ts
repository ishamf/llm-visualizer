import { describe, expect, it } from 'vitest';

import {
  BROWSER_MODEL_PATH,
  BROWSER_MODEL_PROFILE,
  BROWSER_MODEL_WEIGHTS_PATH,
  getBrowserModelUrls,
} from './config.ts';

describe('browser model configuration', () => {
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
      getBrowserModelUrls('../model-assets', 'https://example.com/demo/page'),
    ).toEqual({
      root: 'https://example.com/model-assets/',
      model: 'https://example.com/model-assets/Qwen3-0.6B-ONNX',
      weights:
        'https://example.com/model-assets/Qwen3-0.6B-ONNX/onnx/instrumented_int8.onnx',
    });
  });
});
