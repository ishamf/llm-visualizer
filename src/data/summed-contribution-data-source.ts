import type {
  ContributionManifest,
  SummedContributions,
} from '../generation/types.ts';
import type { ContributionDataSource } from './contribution-data-source.ts';
import { parseContributionManifest } from './contribution-data-source.ts';

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
    (value.targetTokenStart !== undefined &&
      value.targetTokenStart !== manifest.promptTokenCount)
  ) {
    throw new Error('Summed contributions have an invalid shape');
  }

  const targetTokenStart = value.targetTokenStart as number | undefined;
  const expectedRows =
    targetTokenStart === undefined
      ? manifest.tokens.length
      : manifest.tokens.length - targetTokenStart;
  if (value.rows.length !== expectedRows) {
    throw new Error('Summed contributions have an invalid row count');
  }
  for (const [rowIndex, row] of value.rows.entries()) {
    const expectedSources =
      targetTokenStart === undefined
        ? rowIndex + 1
        : targetTokenStart + rowIndex;
    if (!Array.isArray(row) || row.length !== expectedSources) {
      throw new Error(`Summed contribution row ${rowIndex} is not causal`);
    }
    for (const contribution of row) {
      if (
        typeof contribution !== 'number' ||
        !Number.isFinite(contribution) ||
        contribution < 0
      ) {
        throw new Error(
          `Summed contribution row ${rowIndex} contains an invalid value`,
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
    const generatedTokenCount =
      manifest.tokens.length - manifest.promptTokenCount;
    const rows = Array.from({ length: generatedTokenCount }, (_, rowIndex) =>
      Array<number>(manifest.promptTokenCount + rowIndex).fill(0),
    );
    for (const layer of layers) {
      for (let rowIndex = 0; rowIndex < rows.length; ++rowIndex) {
        const incoming = layer.rows[manifest.promptTokenCount - 1 + rowIndex];
        for (const [source, contribution] of incoming.entries()) {
          rows[rowIndex][source] += contribution;
        }
      }
    }
    return {
      schemaVersion: manifest.schemaVersion,
      metric: manifest.metric,
      aggregation: 'sum' as const,
      layerCount: manifest.geometry.layers,
      targetTokenStart: manifest.promptTokenCount,
      rows,
    };
  }
}

export class HttpSummedContributionDataSource implements SummedContributionDataSource {
  readonly id: string;
  readonly #baseUrl: string;
  #manifest?: ContributionManifest;

  constructor(id: string, baseUrl: string, manifest?: ContributionManifest) {
    this.id = id;
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#manifest = manifest;
  }

  async getManifest(signal?: AbortSignal) {
    if (this.#manifest) return this.#manifest;
    const value = await this.#fetchJson('manifest.json', signal);
    const manifest = parseContributionManifest(value);
    this.#manifest = manifest;
    return manifest;
  }

  async getContributions(signal?: AbortSignal) {
    const manifest = await this.getManifest(signal);
    const value = await this.#fetchJson('contributions.json', signal);
    return parseSummedContributions(value, manifest);
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
