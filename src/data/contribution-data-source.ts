import type {
  ContributionDataset,
  ContributionLayer,
  ContributionManifest,
} from '../generation/types.ts';

export interface ContributionDataSource {
  readonly id: string;
  getManifest(signal?: AbortSignal): Promise<ContributionManifest>;
  getLayer(layer: number, signal?: AbortSignal): Promise<ContributionLayer>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseContributionManifest(
  value: unknown,
): ContributionManifest {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.metric !== 'string' ||
    typeof value.prompt !== 'string' ||
    !Array.isArray(value.tokens) ||
    !isRecord(value.geometry) ||
    !Number.isSafeInteger(value.geometry.layers) ||
    !Number.isSafeInteger(value.promptTokenCount)
  ) {
    throw new Error('Contribution manifest has an unsupported shape');
  }

  for (const [index, token] of value.tokens.entries()) {
    if (
      !isRecord(token) ||
      !Number.isSafeInteger(token.id) ||
      typeof token.text !== 'string'
    ) {
      throw new Error(`Contribution manifest token ${index} is invalid`);
    }
  }

  const promptTokenCount = value.promptTokenCount as number;
  if (promptTokenCount < 1 || promptTokenCount > value.tokens.length) {
    throw new Error('Contribution manifest prompt token count is invalid');
  }

  const layerCount = value.geometry.layers as number;
  if (layerCount < 1) {
    throw new Error('Contribution manifest layer count is invalid');
  }

  return value as ContributionManifest;
}

export function parseContributionLayer(
  value: unknown,
  manifest: ContributionManifest,
  expectedLayer: number,
): ContributionLayer {
  if (
    !isRecord(value) ||
    value.schemaVersion !== manifest.schemaVersion ||
    value.metric !== manifest.metric ||
    value.layer !== expectedLayer ||
    !Array.isArray(value.rows) ||
    value.rows.length !== manifest.tokens.length
  ) {
    throw new Error(`Contribution layer ${expectedLayer} has an invalid shape`);
  }

  for (const [destination, row] of value.rows.entries()) {
    if (!Array.isArray(row) || row.length !== destination + 1) {
      throw new Error(
        `Contribution layer ${expectedLayer} row ${destination} is not causal`,
      );
    }
    for (const contribution of row) {
      if (
        typeof contribution !== 'number' ||
        !Number.isFinite(contribution) ||
        contribution < 0
      ) {
        throw new Error(
          `Contribution layer ${expectedLayer} row ${destination} contains an invalid value`,
        );
      }
    }
  }

  return value as ContributionLayer;
}

export class InMemoryContributionDataSource implements ContributionDataSource {
  readonly id: string;
  readonly #dataset: ContributionDataset;

  constructor(id: string, dataset: ContributionDataset) {
    this.id = id;
    this.#dataset = dataset;
  }

  async getManifest() {
    return this.#dataset.manifest;
  }

  async getLayer(layer: number) {
    const contributionLayer = this.#dataset.layers[layer];
    if (!contributionLayer) {
      throw new Error(`Dataset ${this.id} does not contain layer ${layer}`);
    }
    return contributionLayer;
  }
}

export class HttpContributionDataSource implements ContributionDataSource {
  readonly id: string;
  readonly #baseUrl: string;
  #manifest?: ContributionManifest;

  constructor(id: string, baseUrl: string) {
    this.id = id;
    this.#baseUrl = baseUrl.replace(/\/$/, '');
  }

  async getManifest(signal?: AbortSignal) {
    if (this.#manifest) return this.#manifest;
    const value = await this.#fetchJson('manifest.json', signal);
    const manifest = parseContributionManifest(value);
    this.#manifest = manifest;
    return manifest;
  }

  async getLayer(layer: number, signal?: AbortSignal) {
    const manifest = await this.getManifest(signal);
    if (
      !Number.isSafeInteger(layer) ||
      layer < 0 ||
      layer >= manifest.geometry.layers
    ) {
      throw new Error(`Layer ${layer} is outside the dataset`);
    }
    const file = `layer-${layer.toString().padStart(2, '0')}.json`;
    const value = await this.#fetchJson(file, signal);
    return parseContributionLayer(value, manifest, layer);
  }

  async #fetchJson(file: string, signal?: AbortSignal) {
    const response = await fetch(`${this.#baseUrl}/${file}`, { signal });
    if (!response.ok) {
      throw new Error(
        `Could not load ${file}: ${response.status} ${response.statusText}`,
      );
    }
    return response.json() as Promise<unknown>;
  }
}
