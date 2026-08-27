export const MODEL_ID = 'Qwen3-0.6B-ONNX';
export const MODEL_DTYPE = 'q4f16';
export const INSTRUMENTED_MODEL_NAME = 'instrumented';

/** The static model directory exposed by the Vite app. */
export const BROWSER_MODEL_PATH = '/models/Qwen3-0.6B-ONNX';
export const BROWSER_MODEL_WEIGHTS_PATH = `${BROWSER_MODEL_PATH}/onnx/${INSTRUMENTED_MODEL_NAME}_${MODEL_DTYPE}.onnx`;
/** Approximate size of the instrumented q4f16 ONNX weights. */
export const BROWSER_MODEL_SIZE_BYTES = 570_000_000;

export const LAYER_COUNT = 28;
export const QUERY_HEAD_COUNT = 16;
export const KV_HEAD_COUNT = 8;
export const HEAD_DIMENSION = 128;
export const HIDDEN_SIZE = QUERY_HEAD_COUNT * HEAD_DIMENSION;

export const MAX_GENERATED_TOKENS = 1_000;
export const DEFAULT_GENERATION_SEED = 42;
export const GENERATION_TEMPERATURE = 0.6;
export const GENERATION_TOP_K = 20;
export const GENERATION_TOP_P = 0.95;
export const GENERATION_EOS_TOKEN_IDS = [151645, 151643] as const;
export const CONTEXT_ABSOLUTE_TOLERANCE = 0.025;
export const LOGITS_ABSOLUTE_TOLERANCE = 1e-5;
export const DATASET_SCHEMA_VERSION = 1 as const;
export const CONTRIBUTION_METRIC =
  'unprojected-attention-contribution-rss' as const;
