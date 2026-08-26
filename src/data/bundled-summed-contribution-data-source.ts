import type {
  ContributionManifest,
  SummedContributions,
} from '../generation/types.ts';
import { parseContributionManifest } from './contribution-data-source.ts';
import {
  parseSummedContributions,
  type SummedContributionDataSource,
} from './summed-contribution-data-source.ts';

type JsonModule = { default: unknown };
type JsonLoader = () => Promise<JsonModule>;

const manifestModules = import.meta.glob<JsonModule>(
  '../../generated/summed-contributions/*/manifest.json',
  { eager: true },
);
const contributionModules = import.meta.glob<JsonModule>(
  '../../generated/summed-contributions/*/contributions.json',
);

export type BundledSummedContributionDataset = {
  id: string;
  manifest: ContributionManifest;
};

const bundledDatasets = Object.entries(manifestModules)
  .map(([path, module]): BundledSummedContributionDataset => {
    const id = path.match(
      /\/summed-contributions\/([^/]+)\/manifest\.json$/,
    )?.[1];
    if (!id) throw new Error(`Could not determine dataset ID from ${path}`);
    return { id, manifest: parseContributionManifest(module.default) };
  })
  .sort((left, right) => left.id.localeCompare(right.id));

export function getBundledSummedContributionDatasets(): readonly BundledSummedContributionDataset[] {
  return bundledDatasets;
}

export class BundledSummedContributionDataSource implements SummedContributionDataSource {
  readonly id: string;
  readonly #manifest: ContributionManifest;
  readonly #loader: JsonLoader;

  constructor(id: string) {
    this.id = id;
    const root = `../../generated/summed-contributions/${id}`;
    const manifestModule = manifestModules[`${root}/manifest.json`];
    const loader = contributionModules[`${root}/contributions.json`];
    if (!manifestModule || !loader) {
      throw new Error(
        `Bundled summed contribution dataset ${id} was not found`,
      );
    }
    this.#manifest = parseContributionManifest(manifestModule.default);
    this.#loader = loader;
  }

  async getManifest() {
    return this.#manifest;
  }

  async getContributions(): Promise<SummedContributions> {
    const module = await this.#loader();
    return parseSummedContributions(module.default, this.#manifest);
  }
}
