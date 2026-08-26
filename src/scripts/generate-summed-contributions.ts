import process from 'node:process';

import { generateSummedContributionDataset } from '../generation/generate.ts';
import { writeSummedContributionDataset } from '../generation/summed-dataset.ts';
import { runContributionGeneration } from './run-contribution-generation.ts';

await runContributionGeneration(process.argv.slice(2), {
  format: 'summed',
  defaultOutputRoot: 'generated/summed-contributions',
  noun: 'summed contributions for',
  generate: generateSummedContributionDataset,
  write: writeSummedContributionDataset,
  outputDescription: (dataset) =>
    `in one matrix summed across ${dataset.contributions.layerCount} layers`,
});
