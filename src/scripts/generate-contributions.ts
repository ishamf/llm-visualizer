import process from 'node:process';

import { writeContributionDataset } from '../generation/dataset.ts';
import { generateContributionDataset } from '../generation/generate.ts';
import { runContributionGeneration } from './run-contribution-generation.ts';

await runContributionGeneration(process.argv.slice(2), {
  format: 'layered',
  defaultOutputRoot: 'generated/contributions',
  noun: 'layered contributions for',
  generate: generateContributionDataset,
  write: writeContributionDataset,
  outputDescription: (dataset) => `across ${dataset.layers.length} layer files`,
});
