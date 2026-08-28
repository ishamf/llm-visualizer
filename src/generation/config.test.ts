import { describe, expect, it } from 'vitest';

import {
  BROWSER_MODEL_PATH,
  BROWSER_MODEL_PROFILE,
  BROWSER_MODEL_WEIGHTS_PATH,
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
});
