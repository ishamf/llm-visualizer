import { fileURLToPath } from 'node:url';

export const MODEL_ID = 'Qwen3-0.6B-ONNX';
export const MODEL_DTYPE = 'q4f16';
export const MODEL_ROOT = fileURLToPath(
  new URL('../../models/', import.meta.url),
);
export const INSTRUMENTED_MODEL_NAME = 'instrumented';

export const LAYER_COUNT = 28;
export const QUERY_HEAD_COUNT = 16;
export const KV_HEAD_COUNT = 8;
export const HEAD_DIMENSION = 128;
export const HIDDEN_SIZE = QUERY_HEAD_COUNT * HEAD_DIMENSION;

export const MAX_GENERATED_TOKENS = 1_000;
export const CONTEXT_ABSOLUTE_TOLERANCE = 0.025;
export const LOGITS_ABSOLUTE_TOLERANCE = 1e-5;
export const DATASET_SCHEMA_VERSION = 1 as const;
export const CONTRIBUTION_METRIC =
  'unprojected-attention-contribution-rss' as const;
