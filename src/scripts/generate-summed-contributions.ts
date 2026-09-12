import process from 'node:process';

import { generateSummedContributionDataset } from '../generation/generate.ts';
import { writeSummedContributionDataset } from '../generation/summed-dataset.ts';
import { runContributionGeneration } from './run-contribution-generation.ts';

await runContributionGeneration(process.argv.slice(2), {
  format: 'summed',
  defaultOutputRoot: 'generated/summed-contributions',
  noun: 'summed contributions for',
  showProgress: true,
  // One model run backs both outputs: the all-layer sum and the per-layer
  // generated-token matrices that let the visualization re-sum layer ranges.
  generate: (options) =>
    generateSummedContributionDataset({ ...options, collectLayerRows: true }),
  write: writeSummedContributionDataset,
  outputDescription: (dataset) =>
    `as ${dataset.contributions.rows.length} generated-token rows summed across ${dataset.contributions.layerCount} layers plus per-layer generated-token matrices`,
});
