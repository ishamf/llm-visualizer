import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CONTRIBUTION_METRIC, DATASET_SCHEMA_VERSION } from './config.ts';
import { writeDatasetAtomically } from './atomic-dataset.ts';
import { serializedJson, validateContributionManifest } from './dataset.ts';
import type {
  ContributionManifest,
  LayeredGeneratedContributions,
  SummedContributionDataset,
  SummedContributions,
} from './types.ts';

function layerFileName(layer: number) {
  return `layer-${layer.toString().padStart(2, '0')}.json`;
}

export function validateSummedContributions(
  contributions: SummedContributions,
  manifest: ContributionManifest,
) {
  if (
    contributions.schemaVersion !== DATASET_SCHEMA_VERSION ||
    contributions.metric !== CONTRIBUTION_METRIC ||
    contributions.aggregation !== 'sum' ||
    contributions.layerCount !== manifest.geometry.layers
  ) {
    throw new Error('Summed contribution metadata is inconsistent');
  }
  const targetTokenStart = contributions.targetTokenStart;
  const expectedRows =
    targetTokenStart === undefined
      ? manifest.tokens.length
      : manifest.tokens.length - targetTokenStart;
  if (
    targetTokenStart !== undefined &&
    targetTokenStart !== manifest.promptTokenCount
  ) {
    throw new Error('Summed contribution target token start is inconsistent');
  }
  if (contributions.rows.length !== expectedRows) {
    throw new Error(
      `Summed contributions have ${contributions.rows.length} rows, expected ${expectedRows}`,
    );
  }
  for (const [rowIndex, row] of contributions.rows.entries()) {
    const expectedSources =
      targetTokenStart === undefined
        ? rowIndex + 1
        : targetTokenStart + rowIndex;
    if (row.length !== expectedSources) {
      throw new Error(
        `Summed contribution row ${rowIndex} has length ${row.length}, expected ${expectedSources}`,
      );
    }
    for (const value of row) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(
          `Summed contribution row ${rowIndex} contains an invalid value`,
        );
      }
    }
  }
}

export function validateLayeredGeneratedContributions(
  layer: LayeredGeneratedContributions,
  manifest: ContributionManifest,
) {
  if (
    layer.schemaVersion !== DATASET_SCHEMA_VERSION ||
    layer.metric !== CONTRIBUTION_METRIC ||
    !Number.isSafeInteger(layer.layer) ||
    layer.layer < 0 ||
    layer.layer >= manifest.geometry.layers
  ) {
    throw new Error(`Layer ${layer.layer} metadata is inconsistent`);
  }
  if (layer.targetTokenStart !== manifest.promptTokenCount) {
    throw new Error(
      `Layer ${layer.layer} target token start is inconsistent with the manifest`,
    );
  }
  const expectedRows = manifest.tokens.length - manifest.promptTokenCount;
  if (layer.rows.length !== expectedRows) {
    throw new Error(
      `Layer ${layer.layer} has ${layer.rows.length} rows, expected ${expectedRows}`,
    );
  }
  for (const [rowIndex, row] of layer.rows.entries()) {
    const expectedSources = layer.targetTokenStart + rowIndex;
    if (!Array.isArray(row) || row.length !== expectedSources) {
      throw new Error(
        `Layer ${layer.layer} row ${rowIndex} has length ${row?.length}, expected ${expectedSources}`,
      );
    }
    for (const value of row) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(
          `Layer ${layer.layer} row ${rowIndex} contains an invalid value`,
        );
      }
    }
  }
}

/**
 * Checks that the per-layer generated-token matrices (when present) are
 * complete and sum exactly to the summed contributions, which guarantees both
 * outputs describe the same single generation run.
 */
export function validateSummedContributionDataset(
  dataset: SummedContributionDataset,
) {
  validateContributionManifest(dataset.manifest);
  validateSummedContributions(dataset.contributions, dataset.manifest);

  const manifest = dataset.manifest;
  if (dataset.layers === undefined) {
    if (manifest.layeredGeneratedContributions === true) {
      throw new Error(
        'Manifest claims layered generated contributions but none are present',
      );
    }
    return;
  }
  if (manifest.layeredGeneratedContributions !== true) {
    throw new Error(
      'Layered generated contributions are present but the manifest does not declare them',
    );
  }
  if (dataset.layers.length !== manifest.geometry.layers) {
    throw new Error(
      `Dataset has ${dataset.layers.length} layered generated contributions, expected ${manifest.geometry.layers}`,
    );
  }
  const generatedTokenCount =
    manifest.tokens.length - manifest.promptTokenCount;
  for (const [layerIndex, layer] of dataset.layers.entries()) {
    if (layer.layer !== layerIndex) {
      throw new Error(
        `Layered generated contribution at index ${layerIndex} reports layer ${layer.layer}`,
      );
    }
    validateLayeredGeneratedContributions(layer, manifest);
  }
  for (let rowIndex = 0; rowIndex < generatedTokenCount; ++rowIndex) {
    const summedRow = dataset.contributions.rows[rowIndex];
    for (let source = 0; source < summedRow.length; ++source) {
      let total = 0;
      for (const layer of dataset.layers) {
        total += layer.rows[rowIndex][source];
      }
      if (total !== summedRow[source]) {
        throw new Error(
          `Layered generated contributions do not sum to the summed contributions at row ${rowIndex} source ${source}`,
        );
      }
    }
  }
}

async function validateStagedDataset(directory: string) {
  const manifest = JSON.parse(
    await readFile(path.join(directory, 'manifest.json'), 'utf8'),
  ) as ContributionManifest;
  const contributions = JSON.parse(
    await readFile(path.join(directory, 'contributions.json'), 'utf8'),
  ) as SummedContributions;
  const layers =
    manifest.layeredGeneratedContributions === true
      ? await Promise.all(
          Array.from({ length: manifest.geometry.layers }, (_, layer) =>
            readFile(path.join(directory, layerFileName(layer)), 'utf8').then(
              (content) => JSON.parse(content) as LayeredGeneratedContributions,
            ),
          ),
        )
      : undefined;
  validateSummedContributionDataset({
    manifest,
    contributions,
    ...(layers ? { layers } : {}),
  });
}

export async function writeSummedContributionDataset(
  outputRoot: string,
  promptId: string,
  dataset: SummedContributionDataset,
  overwrite = false,
) {
  validateSummedContributionDataset(dataset);
  return writeDatasetAtomically(
    outputRoot,
    promptId,
    overwrite,
    async (temporary) => {
      await Promise.all([
        writeFile(
          path.join(temporary, 'manifest.json'),
          serializedJson(dataset.manifest),
        ),
        writeFile(
          path.join(temporary, 'contributions.json'),
          serializedJson(dataset.contributions),
        ),
        ...(dataset.layers ?? []).map((layer) =>
          writeFile(
            path.join(temporary, layerFileName(layer.layer)),
            serializedJson(layer),
          ),
        ),
      ]);
    },
    validateStagedDataset,
  );
}
