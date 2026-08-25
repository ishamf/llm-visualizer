import type { Tensor } from '@huggingface/transformers';

import type { CONTRIBUTION_METRIC, DATASET_SCHEMA_VERSION } from './config.ts';

export type NumericArray = ArrayLike<number | bigint>;

export type ModelTensor = {
  data: NumericArray;
  dims: number[];
  type: string;
  dispose?: () => void;
};

export type ModelOutputs = Record<string, ModelTensor>;

export type ModelInputs = Record<string, Tensor | Record<string, ModelTensor>>;

export type CausalLanguageModel = {
  forward: (inputs: ModelInputs) => Promise<ModelOutputs>;
  dispose: () => Promise<void>;
};

export type Tokenizer = {
  eos_token_id: number | number[] | null;
  encode: (
    text: string,
    options?: { add_special_tokens?: boolean },
  ) => number[];
  apply_chat_template: (
    messages: Array<{ role: string; content: string }>,
    options: Record<string, unknown>,
  ) => unknown;
  decode: (
    tokenIds: Array<number | bigint>,
    options?: Record<string, boolean>,
  ) => string;
};

export type ValidationStats = {
  count: number;
  maxAbsoluteError: number;
  meanAbsoluteError: number;
};

export type PromptConfiguration = {
  id: string;
  prompt: string;
  systemPrompt?: string;
  assistantPrefix?: string;
  maxNewTokens?: number;
};

export type ValidatedPromptConfiguration = PromptConfiguration & {
  maxNewTokens: number;
};

export type DatasetToken = {
  id: number;
  text: string;
};

export type StopReason = 'eos' | 'max_new_tokens';

export type ContributionManifest = {
  schemaVersion: typeof DATASET_SCHEMA_VERSION;
  metric: typeof CONTRIBUTION_METRIC;
  model: {
    id: string;
    dtype: string;
    instrumentation: string;
  };
  prompt: string;
  systemPrompt?: string;
  assistantPrefix?: string;
  generatedText: string;
  promptTokenCount: number;
  tokens: DatasetToken[];
  geometry: {
    layers: number;
    queryHeads: number;
    kvHeads: number;
    headDimension: number;
  };
  generation: {
    method: 'greedy';
    maxNewTokens: number;
    stopReason: StopReason;
  };
  validation: {
    logitsMaxAbsoluteError: number;
    contextsMaxAbsoluteError: number;
  };
};

export type ContributionLayer = {
  schemaVersion: typeof DATASET_SCHEMA_VERSION;
  layer: number;
  metric: typeof CONTRIBUTION_METRIC;
  rows: number[][];
};

export type ContributionDataset = {
  manifest: ContributionManifest;
  layers: ContributionLayer[];
};
