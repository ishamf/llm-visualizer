export type ModelGeometry = {
  layers: number;
  queryHeads: number;
  kvHeads: number;
  headDimension: number;
};

export type ModelProfile = {
  key: string;
  id: string;
  dtype: 'int8';
  instrumentation: string;
  geometry: ModelGeometry;
  generation: GenerationDefaults;
  contextAbsoluteTolerance: number;
  logitsAbsoluteTolerance: number;
};

export type GenerationDefaults = {
  maxGeneratedTokens: number;
  seed: number;
  temperature: number;
  topK: number;
  topP: number;
};

const QWEN3_GENERATION_DEFAULTS = {
  maxGeneratedTokens: 1_000,
  seed: 42,
  temperature: 0.6,
  topK: 20,
  topP: 0.95,
} as const satisfies GenerationDefaults;

const QWEN3_GEOMETRY = {
  layers: 28,
  queryHeads: 16,
  kvHeads: 8,
  headDimension: 128,
} as const satisfies ModelGeometry;

export const MODEL_PROFILES = {
  'qwen3-0.6b': {
    key: 'qwen3-0.6b',
    id: 'Qwen3-0.6B-ONNX',
    dtype: 'int8',
    instrumentation: 'instrumented',
    geometry: QWEN3_GEOMETRY,
    generation: QWEN3_GENERATION_DEFAULTS,
    contextAbsoluteTolerance: 0.025,
    logitsAbsoluteTolerance: 1e-5,
  },
  'qwen3-1.7b': {
    key: 'qwen3-1.7b',
    id: 'Qwen3-1.7B-ONNX',
    dtype: 'int8',
    instrumentation: 'instrumented',
    geometry: QWEN3_GEOMETRY,
    generation: QWEN3_GENERATION_DEFAULTS,
    contextAbsoluteTolerance: 0.025,
    logitsAbsoluteTolerance: 1e-5,
  },
} as const satisfies Record<string, ModelProfile>;

export type ModelKey = keyof typeof MODEL_PROFILES;

export const DEFAULT_EXPORT_MODEL_KEY: ModelKey = 'qwen3-0.6b';
export const UI_MODEL_KEY: ModelKey = 'qwen3-1.7b';
export const UI_MODEL_PROFILE: ModelProfile = MODEL_PROFILES[UI_MODEL_KEY];
export const BROWSER_MODEL_PROFILE: ModelProfile = MODEL_PROFILES['qwen3-0.6b'];

const MODEL_ALIASES: Record<string, ModelKey> = {
  '0.6b': 'qwen3-0.6b',
  '1.7b': 'qwen3-1.7b',
  'qwen3-0.6b': 'qwen3-0.6b',
  'qwen3-1.7b': 'qwen3-1.7b',
};

export function parseModelKey(value: string): ModelKey {
  const key = MODEL_ALIASES[value.toLowerCase()];
  if (!key) {
    throw new Error(
      `Unknown model ${JSON.stringify(value)}. Available models: ${Object.keys(MODEL_PROFILES).join(', ')}`,
    );
  }
  return key;
}

// These defaults remain available to the command-line validation scripts.
export const MODEL_ID = UI_MODEL_PROFILE.id;
export const MODEL_DTYPE = UI_MODEL_PROFILE.dtype;
export const INSTRUMENTED_MODEL_NAME = UI_MODEL_PROFILE.instrumentation;

/** The static model directory exposed by the Vite app. */
export const BROWSER_MODEL_ROOT = '/models/';
export const BROWSER_MODEL_PATH = `${BROWSER_MODEL_ROOT}${BROWSER_MODEL_PROFILE.id}`;
export const BROWSER_MODEL_WEIGHTS_PATH = `${BROWSER_MODEL_PATH}/onnx/${BROWSER_MODEL_PROFILE.instrumentation}_${BROWSER_MODEL_PROFILE.dtype}.onnx`;
/** Approximate size of the instrumented int8 ONNX weights. */
export const BROWSER_MODEL_SIZE_BYTES = 617_690_408;

export const LAYER_COUNT = UI_MODEL_PROFILE.geometry.layers;
export const QUERY_HEAD_COUNT = UI_MODEL_PROFILE.geometry.queryHeads;
export const KV_HEAD_COUNT = UI_MODEL_PROFILE.geometry.kvHeads;
export const HEAD_DIMENSION = UI_MODEL_PROFILE.geometry.headDimension;
export const HIDDEN_SIZE = QUERY_HEAD_COUNT * HEAD_DIMENSION;

export const MAX_GENERATED_TOKENS =
  UI_MODEL_PROFILE.generation.maxGeneratedTokens;
export const DEFAULT_GENERATION_SEED = UI_MODEL_PROFILE.generation.seed;
export const GENERATION_TEMPERATURE = UI_MODEL_PROFILE.generation.temperature;
export const GENERATION_TOP_K = UI_MODEL_PROFILE.generation.topK;
export const GENERATION_TOP_P = UI_MODEL_PROFILE.generation.topP;
export const GENERATION_EOS_TOKEN_IDS = [151645, 151643] as const;
export const CONTEXT_ABSOLUTE_TOLERANCE =
  UI_MODEL_PROFILE.contextAbsoluteTolerance;
export const LOGITS_ABSOLUTE_TOLERANCE =
  UI_MODEL_PROFILE.logitsAbsoluteTolerance;
export const DATASET_SCHEMA_VERSION = 1 as const;
export const CONTRIBUTION_METRIC =
  'unprojected-attention-contribution-rss' as const;
