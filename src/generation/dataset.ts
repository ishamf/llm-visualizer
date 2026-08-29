import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CONTRIBUTION_METRIC, DATASET_SCHEMA_VERSION } from './config.ts';
import type {
  ContributionDataset,
  ContributionLayer,
  ContributionManifest,
} from './types.ts';
import { writeDatasetAtomically } from './atomic-dataset.ts';

function assertFiniteNonNegative(value: number, location: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${location} must be finite and non-negative`);
  }
}

export function validateContributionManifest(manifest: ContributionManifest) {
  if (manifest.schemaVersion !== DATASET_SCHEMA_VERSION) {
    throw new Error(`Unsupported manifest schema ${manifest.schemaVersion}`);
  }
  if (manifest.metric !== CONTRIBUTION_METRIC) {
    throw new Error(`Unexpected manifest metric ${manifest.metric}`);
  }
  if (
    manifest.model.id.trim().length === 0 ||
    manifest.model.dtype.trim().length === 0 ||
    manifest.model.instrumentation.trim().length === 0
  ) {
    throw new Error('Manifest model metadata is incomplete');
  }
  if (manifest.title !== undefined && manifest.title.trim().length === 0) {
    throw new Error('Manifest title must not be empty');
  }
  if (!Number.isInteger(manifest.promptTokenCount)) {
    throw new Error('Manifest promptTokenCount must be an integer');
  }
  if (
    manifest.promptTokenCount < 1 ||
    manifest.promptTokenCount > manifest.tokens.length
  ) {
    throw new Error('Manifest promptTokenCount is outside the token range');
  }
  if (
    !Number.isSafeInteger(manifest.geometry.layers) ||
    manifest.geometry.layers < 1 ||
    !Number.isSafeInteger(manifest.geometry.queryHeads) ||
    manifest.geometry.queryHeads < 1 ||
    !Number.isSafeInteger(manifest.geometry.kvHeads) ||
    manifest.geometry.kvHeads < 1 ||
    manifest.geometry.queryHeads % manifest.geometry.kvHeads !== 0 ||
    !Number.isSafeInteger(manifest.geometry.headDimension) ||
    manifest.geometry.headDimension < 1
  ) {
    throw new Error('Manifest model geometry is invalid');
  }
  const generatedTokenCount =
    manifest.tokens.length - manifest.promptTokenCount;
  if (
    (manifest.generation.method !== 'greedy' &&
      manifest.generation.method !== 'sampling') ||
    !Number.isSafeInteger(manifest.generation.maxNewTokens) ||
    generatedTokenCount > manifest.generation.maxNewTokens ||
    (manifest.generation.stopReason === 'max_new_tokens' &&
      generatedTokenCount !== manifest.generation.maxNewTokens)
  ) {
    throw new Error('Manifest generation metadata is inconsistent');
  }
  if (
    manifest.generation.method === 'sampling' &&
    (!Number.isSafeInteger(manifest.generation.seed) ||
      (manifest.generation.seed ?? -1) < 0 ||
      typeof manifest.generation.enableThinking !== 'boolean' ||
      !Number.isFinite(manifest.generation.temperature) ||
      (manifest.generation.temperature ?? 0) <= 0 ||
      !Number.isSafeInteger(manifest.generation.topK) ||
      (manifest.generation.topK ?? 0) < 1 ||
      !Number.isFinite(manifest.generation.topP) ||
      (manifest.generation.topP ?? 0) <= 0 ||
      (manifest.generation.topP ?? 0) > 1)
  ) {
    throw new Error('Manifest sampling metadata is inconsistent');
  }
  for (const [index, token] of manifest.tokens.entries()) {
    if (!Number.isSafeInteger(token.id)) {
      throw new Error(`Token ${index} has a non-integer ID`);
    }
    if (typeof token.text !== 'string') {
      throw new Error(`Token ${index} text must be a string`);
    }
  }
  if (manifest.validation !== undefined) {
    assertFiniteNonNegative(
      manifest.validation.logitsMaxAbsoluteError,
      'Logits validation error',
    );
    assertFiniteNonNegative(
      manifest.validation.contextsMaxAbsoluteError,
      'Context validation error',
    );
  }
}

export function validateContributionDataset(dataset: ContributionDataset) {
  const { manifest, layers } = dataset;
  validateContributionManifest(manifest);

  if (layers.length !== manifest.geometry.layers) {
    throw new Error(
      `Dataset has ${layers.length} layers, expected ${manifest.geometry.layers}`,
    );
  }
  for (let layerIndex = 0; layerIndex < layers.length; ++layerIndex) {
    const layer = layers[layerIndex];
    if (
      layer.schemaVersion !== DATASET_SCHEMA_VERSION ||
      layer.metric !== CONTRIBUTION_METRIC ||
      layer.layer !== layerIndex
    ) {
      throw new Error(`Layer ${layerIndex} metadata is inconsistent`);
    }
    if (layer.rows.length !== manifest.tokens.length) {
      throw new Error(
        `Layer ${layerIndex} has ${layer.rows.length} rows for ${manifest.tokens.length} tokens`,
      );
    }
    for (let destination = 0; destination < layer.rows.length; ++destination) {
      const row = layer.rows[destination];
      if (row.length !== destination + 1) {
        throw new Error(
          `Layer ${layerIndex} row ${destination} has length ${row.length}, expected ${destination + 1}`,
        );
      }
      for (let source = 0; source < row.length; ++source) {
        assertFiniteNonNegative(
          row[source],
          `Layer ${layerIndex} row ${destination} source ${source}`,
        );
      }
    }
  }
}

function layerFileName(layer: number) {
  return `layer-${layer.toString().padStart(2, '0')}.json`;
}

export function serializedJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function validateStagedDataset(directory: string) {
  const manifest = JSON.parse(
    await readFile(path.join(directory, 'manifest.json'), 'utf8'),
  ) as ContributionManifest;
  const layers: ContributionLayer[] = [];
  for (let layer = 0; layer < manifest.geometry.layers; ++layer) {
    layers.push(
      JSON.parse(
        await readFile(path.join(directory, layerFileName(layer)), 'utf8'),
      ) as ContributionLayer,
    );
  }
  validateContributionDataset({ manifest, layers });
}

export async function writeContributionDataset(
  outputRoot: string,
  promptId: string,
  dataset: ContributionDataset,
  overwrite = false,
) {
  validateContributionDataset(dataset);
  return writeDatasetAtomically(
    outputRoot,
    promptId,
    overwrite,
    async (temporary) => {
      await writeFile(
        path.join(temporary, 'manifest.json'),
        serializedJson(dataset.manifest),
      );
      await Promise.all(
        dataset.layers.map((layer) =>
          writeFile(
            path.join(temporary, layerFileName(layer.layer)),
            serializedJson(layer),
          ),
        ),
      );
    },
    validateStagedDataset,
  );
}
