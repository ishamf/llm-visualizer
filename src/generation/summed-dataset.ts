import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  CONTRIBUTION_METRIC,
  DATASET_SCHEMA_VERSION,
  LAYER_COUNT,
} from './config.ts';
import { writeDatasetAtomically } from './atomic-dataset.ts';
import { serializedJson, validateContributionManifest } from './dataset.ts';
import type {
  ContributionManifest,
  SummedContributionDataset,
  SummedContributions,
} from './types.ts';

export function validateSummedContributions(
  contributions: SummedContributions,
  manifest: ContributionManifest,
) {
  if (
    contributions.schemaVersion !== DATASET_SCHEMA_VERSION ||
    contributions.metric !== CONTRIBUTION_METRIC ||
    contributions.aggregation !== 'sum' ||
    contributions.layerCount !== LAYER_COUNT
  ) {
    throw new Error('Summed contribution metadata is inconsistent');
  }
  if (contributions.rows.length !== manifest.tokens.length) {
    throw new Error(
      `Summed contributions have ${contributions.rows.length} rows for ${manifest.tokens.length} tokens`,
    );
  }
  for (const [destination, row] of contributions.rows.entries()) {
    if (row.length !== destination + 1) {
      throw new Error(
        `Summed contribution row ${destination} has length ${row.length}, expected ${destination + 1}`,
      );
    }
    for (const value of row) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(
          `Summed contribution row ${destination} contains an invalid value`,
        );
      }
    }
  }
}

export function validateSummedContributionDataset(
  dataset: SummedContributionDataset,
) {
  validateContributionManifest(dataset.manifest);
  validateSummedContributions(dataset.contributions, dataset.manifest);
}

async function validateStagedDataset(directory: string) {
  const manifest = JSON.parse(
    await readFile(path.join(directory, 'manifest.json'), 'utf8'),
  ) as ContributionManifest;
  const contributions = JSON.parse(
    await readFile(path.join(directory, 'contributions.json'), 'utf8'),
  ) as SummedContributions;
  validateSummedContributionDataset({ manifest, contributions });
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
      ]);
    },
    validateStagedDataset,
  );
}
