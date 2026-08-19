import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  CONTRIBUTION_METRIC,
  DATASET_SCHEMA_VERSION,
  HEAD_DIMENSION,
  KV_HEAD_COUNT,
  LAYER_COUNT,
  QUERY_HEAD_COUNT,
} from './config.ts';
import type {
  ContributionDataset,
  ContributionLayer,
  ContributionManifest,
} from './types.ts';

async function pathExists(target: string) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function assertFiniteNonNegative(value: number, location: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${location} must be finite and non-negative`);
  }
}

export function validateContributionDataset(dataset: ContributionDataset) {
  const { manifest, layers } = dataset;
  if (manifest.schemaVersion !== DATASET_SCHEMA_VERSION) {
    throw new Error(`Unsupported manifest schema ${manifest.schemaVersion}`);
  }
  if (manifest.metric !== CONTRIBUTION_METRIC) {
    throw new Error(`Unexpected manifest metric ${manifest.metric}`);
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
    manifest.geometry.layers !== LAYER_COUNT ||
    manifest.geometry.queryHeads !== QUERY_HEAD_COUNT ||
    manifest.geometry.kvHeads !== KV_HEAD_COUNT ||
    manifest.geometry.headDimension !== HEAD_DIMENSION
  ) {
    throw new Error('Manifest model geometry is inconsistent');
  }
  const generatedTokenCount =
    manifest.tokens.length - manifest.promptTokenCount;
  if (
    manifest.generation.method !== 'greedy' ||
    !Number.isSafeInteger(manifest.generation.maxNewTokens) ||
    generatedTokenCount > manifest.generation.maxNewTokens ||
    (manifest.generation.stopReason === 'max_new_tokens' &&
      generatedTokenCount !== manifest.generation.maxNewTokens)
  ) {
    throw new Error('Manifest generation metadata is inconsistent');
  }
  for (const [index, token] of manifest.tokens.entries()) {
    if (!Number.isSafeInteger(token.id)) {
      throw new Error(`Token ${index} has a non-integer ID`);
    }
    if (typeof token.text !== 'string') {
      throw new Error(`Token ${index} text must be a string`);
    }
  }
  assertFiniteNonNegative(
    manifest.validation.logitsMaxAbsoluteError,
    'Logits validation error',
  );
  assertFiniteNonNegative(
    manifest.validation.contextsMaxAbsoluteError,
    'Context validation error',
  );

  if (layers.length !== LAYER_COUNT) {
    throw new Error(
      `Dataset has ${layers.length} layers, expected ${LAYER_COUNT}`,
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

function serializedJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function validateStagedDataset(directory: string) {
  const manifest = JSON.parse(
    await readFile(path.join(directory, 'manifest.json'), 'utf8'),
  ) as ContributionManifest;
  const layers: ContributionLayer[] = [];
  for (let layer = 0; layer < LAYER_COUNT; ++layer) {
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
  await mkdir(outputRoot, { recursive: true });

  const destination = path.join(outputRoot, promptId);
  if (!overwrite && (await pathExists(destination))) {
    throw new Error(
      `Dataset destination already exists: ${destination} (use --overwrite to replace it)`,
    );
  }

  const temporary = await mkdtemp(path.join(outputRoot, `.${promptId}.tmp-`));
  let backup: string | undefined;
  try {
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
    await validateStagedDataset(temporary);

    if (await pathExists(destination)) {
      backup = `${destination}.backup-${randomUUID()}`;
      await rename(destination, backup);
    }
    try {
      await rename(temporary, destination);
    } catch (error) {
      if (backup) await rename(backup, destination);
      throw error;
    }
    if (backup) await rm(backup, { recursive: true });
    return destination;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
