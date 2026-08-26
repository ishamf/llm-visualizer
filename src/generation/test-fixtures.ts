import {
  CONTRIBUTION_METRIC,
  DATASET_SCHEMA_VERSION,
  HEAD_DIMENSION,
  KV_HEAD_COUNT,
  LAYER_COUNT,
  QUERY_HEAD_COUNT,
} from './config.ts';
import type { ContributionDataset } from './types.ts';

export function exampleDataset(): ContributionDataset {
  return {
    manifest: {
      schemaVersion: DATASET_SCHEMA_VERSION,
      metric: CONTRIBUTION_METRIC,
      model: {
        id: 'test-model',
        dtype: 'float32',
        instrumentation: 'test',
      },
      prompt: 'Hello',
      assistantPrefix: 'The answer is',
      generatedText: ' world',
      promptTokenCount: 1,
      tokens: [
        { id: 1, text: 'Hello' },
        { id: 2, text: ' world' },
      ],
      geometry: {
        layers: LAYER_COUNT,
        queryHeads: QUERY_HEAD_COUNT,
        kvHeads: KV_HEAD_COUNT,
        headDimension: HEAD_DIMENSION,
      },
      generation: {
        method: 'greedy',
        maxNewTokens: 1,
        stopReason: 'max_new_tokens',
      },
      validation: {
        logitsMaxAbsoluteError: 0,
        contextsMaxAbsoluteError: 0.01,
      },
    },
    layers: Array.from({ length: LAYER_COUNT }, (_, layer) => ({
      schemaVersion: DATASET_SCHEMA_VERSION,
      layer,
      metric: CONTRIBUTION_METRIC,
      rows: [[1], [0.5, 2]],
    })),
  };
}
