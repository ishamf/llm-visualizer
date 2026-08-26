import type {
  ContributionManifest,
  SummedContributions,
} from '../generation/types.ts';
import type { ContributionDataSource } from './contribution-data-source.ts';

export interface SummedContributionDataSource {
  readonly id: string;
  getManifest(signal?: AbortSignal): Promise<ContributionManifest>;
  getContributions(signal?: AbortSignal): Promise<SummedContributions>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseSummedContributions(
  value: unknown,
  manifest: ContributionManifest,
): SummedContributions {
  if (
    !isRecord(value) ||
    value.schemaVersion !== manifest.schemaVersion ||
    value.metric !== manifest.metric ||
    value.aggregation !== 'sum' ||
    value.layerCount !== manifest.geometry.layers ||
    !Array.isArray(value.rows) ||
    value.rows.length !== manifest.tokens.length
  ) {
    throw new Error('Summed contributions have an invalid shape');
  }

  for (const [destination, row] of value.rows.entries()) {
    if (!Array.isArray(row) || row.length !== destination + 1) {
      throw new Error(`Summed contribution row ${destination} is not causal`);
    }
    for (const contribution of row) {
      if (
        typeof contribution !== 'number' ||
        !Number.isFinite(contribution) ||
        contribution < 0
      ) {
        throw new Error(
          `Summed contribution row ${destination} contains an invalid value`,
        );
      }
    }
  }
  return value as SummedContributions;
}

export class LayerSummingContributionDataSource implements SummedContributionDataSource {
  readonly id: string;
  readonly #source: ContributionDataSource;

  constructor(source: ContributionDataSource) {
    this.id = source.id;
    this.#source = source;
  }

  getManifest(signal?: AbortSignal) {
    return this.#source.getManifest(signal);
  }

  async getContributions(signal?: AbortSignal) {
    const manifest = await this.getManifest(signal);
    const layers = await Promise.all(
      Array.from({ length: manifest.geometry.layers }, (_, layer) =>
        this.#source.getLayer(layer, signal),
      ),
    );
    const rows = Array.from(
      { length: manifest.tokens.length },
      (_, destination) => Array<number>(destination + 1).fill(0),
    );
    for (const layer of layers) {
      for (const [destination, incoming] of layer.rows.entries()) {
        for (const [source, contribution] of incoming.entries()) {
          rows[destination][source] += contribution;
        }
      }
    }
    return {
      schemaVersion: manifest.schemaVersion,
      metric: manifest.metric,
      aggregation: 'sum' as const,
      layerCount: manifest.geometry.layers,
      rows,
    };
  }
}
