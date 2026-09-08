import type {
  ContributionLayer,
  ContributionManifest,
  LayeredGeneratedContributions,
  SummedContributions,
} from '../generation/types.ts';
import type { ContributionDataSource } from './contribution-data-source.ts';
import {
  layerFileName,
  parseContributionManifest,
} from './contribution-data-source.ts';

export interface SummedContributionDataSource {
  readonly id: string;
  getManifest(signal?: AbortSignal): Promise<ContributionManifest>;
  getContributions(signal?: AbortSignal): Promise<SummedContributions>;
}

/** Inclusive range of transformer layers to sum, counted from layer 0. */
export type LayerRange = {
  firstLayer: number;
  lastLayer: number;
};

export function fullLayerRange(layerCount: number): LayerRange {
  return { firstLayer: 0, lastLayer: layerCount - 1 };
}

export function sameLayerRange(a: LayerRange, b: LayerRange): boolean {
  return a.firstLayer === b.firstLayer && a.lastLayer === b.lastLayer;
}

export function isFullLayerRange(
  range: LayerRange,
  layerCount: number,
): boolean {
  return sameLayerRange(range, fullLayerRange(layerCount));
}

function normalizeLayerRange(
  range: LayerRange | undefined,
  layerCount: number,
): LayerRange {
  const resolved = range ?? fullLayerRange(layerCount);
  const { firstLayer, lastLayer } = resolved;
  if (
    !Number.isSafeInteger(firstLayer) ||
    !Number.isSafeInteger(lastLayer) ||
    firstLayer < 0 ||
    lastLayer < firstLayer ||
    lastLayer >= layerCount
  ) {
    throw new Error(
      `Layer range ${firstLayer}-${lastLayer} is outside the dataset's ${layerCount} layers`,
    );
  }
  return resolved;
}

/** A summed-contribution source that can also sum an arbitrary layer range. */
export interface LayerRangeSummedContributionDataSource extends SummedContributionDataSource {
  getContributions(
    signal?: AbortSignal,
    range?: LayerRange,
  ): Promise<SummedContributions>;
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

export function parseLayeredGeneratedContributions(
  value: unknown,
  manifest: ContributionManifest,
  expectedLayer: number,
): LayeredGeneratedContributions {
  if (
    !isRecord(value) ||
    value.schemaVersion !== manifest.schemaVersion ||
    value.metric !== manifest.metric ||
    value.layer !== expectedLayer ||
    value.targetTokenStart !== manifest.promptTokenCount ||
    !Array.isArray(value.rows)
  ) {
    throw new Error(
      `Layered generated contributions for layer ${expectedLayer} have an invalid shape`,
    );
  }

  const targetTokenStart = value.targetTokenStart as number;
  const expectedRows = manifest.tokens.length - targetTokenStart;
  if (value.rows.length !== expectedRows) {
    throw new Error(
      `Layered generated contributions for layer ${expectedLayer} have an invalid row count`,
    );
  }
  for (const [rowIndex, row] of value.rows.entries()) {
    const expectedSources = targetTokenStart + rowIndex;
    if (!Array.isArray(row) || row.length !== expectedSources) {
      throw new Error(
        `Layered generated contribution row ${rowIndex} is not causal`,
      );
    }
    for (const contribution of row) {
      if (
        typeof contribution !== 'number' ||
        !Number.isFinite(contribution) ||
        contribution < 0
      ) {
        throw new Error(
          `Layered generated contribution row ${rowIndex} contains an invalid value`,
        );
      }
    }
  }
  return value as LayeredGeneratedContributions;
}

export class LayerSummingContributionDataSource implements LayerRangeSummedContributionDataSource {
  readonly id: string;
  readonly #source: ContributionDataSource;
  readonly #layerRequests = new Map<number, Promise<ContributionLayer>>();

  constructor(source: ContributionDataSource) {
    this.id = source.id;
    this.#source = source;
  }

  getManifest(signal?: AbortSignal) {
    return this.#source.getManifest(signal);
  }

  #loadLayer(layer: number): Promise<ContributionLayer> {
    const cached = this.#layerRequests.get(layer);
    if (cached) return cached;
    // Layer downloads intentionally ignore abort signals: the range control
    // changes constantly while sliding, and every downloaded layer stays
    // useful for the next range.
    const request = this.#source.getLayer(layer);
    this.#layerRequests.set(layer, request);
    void request.catch(() => {
      // Drop failed downloads so a later range change can retry them.
      if (this.#layerRequests.get(layer) === request) {
        this.#layerRequests.delete(layer);
      }
    });
    return request;
  }

  async getContributions(signal?: AbortSignal, range?: LayerRange) {
    const manifest = await this.getManifest(signal);
    const { firstLayer, lastLayer } = normalizeLayerRange(
      range,
      manifest.geometry.layers,
    );
    const layers = await Promise.all(
      Array.from({ length: lastLayer - firstLayer + 1 }, (_, offset) =>
        this.#loadLayer(firstLayer + offset),
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
      layerCount: lastLayer - firstLayer + 1,
      targetTokenStart: manifest.promptTokenCount,
      rows,
    };
  }
}

export class HttpSummedContributionDataSource implements LayerRangeSummedContributionDataSource {
  readonly id: string;
  readonly #baseUrl: string;
  readonly #layerRequests = new Map<
    number,
    Promise<LayeredGeneratedContributions>
  >();
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

  async getContributions(signal?: AbortSignal, range?: LayerRange) {
    const manifest = await this.getManifest(signal);
    // The pre-summed file is the exact all-layer total, so it stays
    // authoritative whenever no sub-range is requested.
    if (!range || isFullLayerRange(range, manifest.geometry.layers)) {
      const value = await this.#fetchJson('contributions.json', signal);
      return parseSummedContributions(value, manifest);
    }
    const { firstLayer, lastLayer } = normalizeLayerRange(
      range,
      manifest.geometry.layers,
    );
    const layers = await Promise.all(
      Array.from({ length: lastLayer - firstLayer + 1 }, (_, offset) =>
        this.getGeneratedLayer(firstLayer + offset),
      ),
    );
    const generatedTokenCount =
      manifest.tokens.length - manifest.promptTokenCount;
    const rows = Array.from({ length: generatedTokenCount }, (_, rowIndex) =>
      Array<number>(manifest.promptTokenCount + rowIndex).fill(0),
    );
    for (const layer of layers) {
      for (const [rowIndex, incoming] of layer.rows.entries()) {
        for (const [source, contribution] of incoming.entries()) {
          rows[rowIndex][source] += contribution;
        }
      }
    }
    return {
      schemaVersion: manifest.schemaVersion,
      metric: manifest.metric,
      aggregation: 'sum' as const,
      layerCount: lastLayer - firstLayer + 1,
      targetTokenStart: manifest.promptTokenCount,
      rows,
    };
  }

  /** Fetches one layer's generated-token matrix, reusing prior downloads. */
  getGeneratedLayer(
    layer: number,
    signal?: AbortSignal,
  ): Promise<LayeredGeneratedContributions> {
    const cached = this.#layerRequests.get(layer);
    if (cached) return cached;
    // Layer downloads intentionally ignore abort signals: the range control
    // changes constantly while sliding, and every downloaded layer stays
    // useful for the next range.
    const request = this.getManifest(signal).then(async (manifest) => {
      if (manifest.layeredGeneratedContributions !== true) {
        throw new Error(
          `Dataset ${this.id} does not ship layered generated contributions`,
        );
      }
      if (
        !Number.isSafeInteger(layer) ||
        layer < 0 ||
        layer >= manifest.geometry.layers
      ) {
        throw new Error(`Layer ${layer} is outside the dataset`);
      }
      const file = layerFileName(layer);
      return parseLayeredGeneratedContributions(
        await this.#fetchJson(file),
        manifest,
        layer,
      );
    });
    this.#layerRequests.set(layer, request);
    void request.catch(() => {
      // Drop failed downloads so a later range change can retry them.
      if (this.#layerRequests.get(layer) === request) {
        this.#layerRequests.delete(layer);
      }
    });
    return request;
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
