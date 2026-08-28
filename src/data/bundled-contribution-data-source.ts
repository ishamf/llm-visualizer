import type {
  ContributionLayer,
  ContributionManifest,
} from '../generation/types.ts';
import { UI_MODEL_KEY } from '../generation/config.ts';
import {
  parseContributionLayer,
  parseContributionManifest,
  type ContributionDataSource,
} from './contribution-data-source.ts';

type JsonModule = { default: unknown };
type JsonLoader = () => Promise<JsonModule>;

const manifestModules = import.meta.glob<JsonModule>(
  '../../generated/contributions/*/*/manifest.json',
  { eager: true },
);
const layerModules = import.meta.glob<JsonModule>(
  '../../generated/contributions/*/*/layer-*.json',
);

export type BundledContributionDataset = {
  id: string;
  manifest: ContributionManifest;
};

const bundledDatasets = Object.entries(manifestModules)
  .filter(([path]) => path.includes(`/contributions/${UI_MODEL_KEY}/`))
  .map(([path, module]): BundledContributionDataset => {
    const id = path.match(
      /\/contributions\/[^/]+\/([^/]+)\/manifest\.json$/,
    )?.[1];
    if (!id) {
      throw new Error(`Could not determine dataset ID from ${path}`);
    }
    return { id, manifest: parseContributionManifest(module.default) };
  })
  .sort((left, right) => left.id.localeCompare(right.id));

export function getBundledContributionDatasets(): readonly BundledContributionDataset[] {
  return bundledDatasets;
}

export class BundledContributionDataSource implements ContributionDataSource {
  readonly id: string;
  readonly #manifest: ContributionManifest;
  readonly #layers: Map<number, JsonLoader>;

  constructor(id: string) {
    this.id = id;
    const root = `../../generated/contributions/${UI_MODEL_KEY}/${id}`;
    const manifestModule = manifestModules[`${root}/manifest.json`];
    if (!manifestModule) {
      throw new Error(`Bundled contribution dataset ${id} was not found`);
    }
    this.#manifest = parseContributionManifest(manifestModule.default);
    this.#layers = new Map(
      Array.from({ length: this.#manifest.geometry.layers }, (_, layer) => {
        const file = `${root}/layer-${layer.toString().padStart(2, '0')}.json`;
        const loader = layerModules[file];
        if (!loader) {
          throw new Error(
            `Bundled contribution dataset ${id} is missing layer ${layer}`,
          );
        }
        return [layer, loader] as const;
      }),
    );
  }

  async getManifest() {
    return this.#manifest;
  }

  async getLayer(layer: number): Promise<ContributionLayer> {
    const loader = this.#layers.get(layer);
    if (!loader) {
      throw new Error(`Dataset ${this.id} does not contain layer ${layer}`);
    }
    const module = await loader();
    return parseContributionLayer(module.default, this.#manifest, layer);
  }
}
