import type {
  ContributionLayer,
  ContributionManifest,
} from '../generation/types.ts';
import {
  parseContributionLayer,
  parseContributionManifest,
  type ContributionDataSource,
} from './contribution-data-source.ts';

type JsonModule = { default: unknown };
type JsonLoader = () => Promise<JsonModule>;

const manifestModules = import.meta.glob<JsonModule>(
  '../../generated/contributions/*/manifest.json',
  { eager: true },
);
const layerModules = import.meta.glob<JsonModule>(
  '../../generated/contributions/*/layer-*.json',
);

export class BundledContributionDataSource implements ContributionDataSource {
  readonly id: string;
  readonly #manifest: ContributionManifest;
  readonly #layers: Map<number, JsonLoader>;

  constructor(id: string) {
    this.id = id;
    const root = `../../generated/contributions/${id}`;
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
