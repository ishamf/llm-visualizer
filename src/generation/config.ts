export type ModelGeometry = {
  layers: number;
  queryHeads: number;
  kvHeads: number;
  headDimension: number;
};

export type ModelVariant = 'int8' | 'uint8' | 'q4f16';

export type ModelProfile = {
  key: string;
  id: string;
  dtype: ModelVariant;
  instrumentation: string;
  modelSizeBytes: number;
  geometry: ModelGeometry;
  generation: GenerationDefaults;
  contextAbsoluteTolerance: number;
  logitsAbsoluteTolerance: number;
};

export type ModelDefinition = Omit<ModelProfile, 'dtype' | 'modelSizeBytes'> & {
  modelSizeBytesByVariant: Record<ModelVariant, number>;
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
  temperature: 0.7,
  topK: 20,
  topP: 0.8,
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
    instrumentation: 'instrumented',
    modelSizeBytesByVariant: {
      int8: 617_690_408,
      uint8: 617_690_408,
      q4f16: 569_795_470,
    },
    geometry: QWEN3_GEOMETRY,
    generation: QWEN3_GENERATION_DEFAULTS,
    contextAbsoluteTolerance: 0.025,
    logitsAbsoluteTolerance: 1e-5,
  },
  'qwen3-1.7b': {
    key: 'qwen3-1.7b',
    id: 'Qwen3-1.7B-ONNX',
    instrumentation: 'instrumented',
    modelSizeBytesByVariant: {
      int8: 1_742_390_682,
      uint8: 1_742_390_682,
      q4f16: 1_426_072_028,
    },
    geometry: QWEN3_GEOMETRY,
    generation: QWEN3_GENERATION_DEFAULTS,
    contextAbsoluteTolerance: 0.025,
    logitsAbsoluteTolerance: 1e-5,
  },
} as const satisfies Record<string, ModelDefinition>;

export type ModelKey = keyof typeof MODEL_PROFILES;

/** The model and quantization variant used by the app and exporter defaults. */
export const MODEL_CONFIGURATION = {
  key: 'qwen3-0.6b',
  variant: 'int8',
} as const satisfies { key: ModelKey; variant: ModelVariant };

export function getModelProfile(
  key: ModelKey,
  variant: ModelVariant,
): ModelProfile {
  const { modelSizeBytesByVariant, ...definition } = MODEL_PROFILES[key];
  return {
    ...definition,
    dtype: variant,
    modelSizeBytes: modelSizeBytesByVariant[variant],
  };
}

export const UI_MODEL_PROFILE = getModelProfile(
  MODEL_CONFIGURATION.key,
  MODEL_CONFIGURATION.variant,
);

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

export function parseModelVariant(value: string): ModelVariant {
  const variant = value.toLowerCase();
  if (variant !== 'int8' && variant !== 'uint8' && variant !== 'q4f16') {
    throw new Error(
      `Unknown model variant ${JSON.stringify(value)}. Available variants: int8, uint8, q4f16`,
    );
  }
  return variant;
}

// These defaults remain available to the command-line validation scripts.
export const MODEL_ID = UI_MODEL_PROFILE.id;
export const MODEL_DTYPE = UI_MODEL_PROFILE.dtype;
export const INSTRUMENTED_MODEL_NAME = UI_MODEL_PROFILE.instrumentation;

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
