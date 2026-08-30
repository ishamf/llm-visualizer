import { MODEL_CONFIGURATION } from '../generation/config.ts';
import type {
  ContributionFormat,
  ContributionManifest,
} from '../generation/types.ts';
import { parseContributionManifest } from './contribution-data-source.ts';

export const DATASET_CATALOG_SCHEMA_VERSION = 2 as const;
export const GENERATED_DATA_BASE_URL =
  import.meta.env.VITE_GENERATED_DATA_BASE_URL || '/generated/';

export type DatasetCatalogEntry = {
  id: string;
  modelKey: string;
  modelVariant: string;
  format: ContributionFormat;
  path: string;
  manifest: ContributionManifest;
};

export type DatasetCatalog = {
  schemaVersion: typeof DATASET_CATALOG_SCHEMA_VERSION;
  datasets: DatasetCatalogEntry[];
};

export type RemoteDataset = DatasetCatalogEntry & { baseUrl: string };

export function matchesModelConfiguration(
  entry: Pick<DatasetCatalogEntry, 'modelKey' | 'modelVariant'>,
) {
  return (
    entry.modelKey === MODEL_CONFIGURATION.key &&
    entry.modelVariant === MODEL_CONFIGURATION.variant
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseDatasetCatalog(value: unknown): DatasetCatalog {
  if (
    !isRecord(value) ||
    value.schemaVersion !== DATASET_CATALOG_SCHEMA_VERSION ||
    !Array.isArray(value.datasets)
  ) {
    throw new Error('Dataset discovery manifest has an unsupported shape');
  }

  const datasets = value.datasets.map((entry, index): DatasetCatalogEntry => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      entry.id.length === 0 ||
      typeof entry.modelKey !== 'string' ||
      entry.modelKey.length === 0 ||
      typeof entry.modelVariant !== 'string' ||
      entry.modelVariant.length === 0 ||
      (entry.format !== 'layered' && entry.format !== 'summed') ||
      typeof entry.path !== 'string' ||
      entry.path.length === 0 ||
      entry.path.startsWith('/') ||
      entry.path.includes('..')
    ) {
      throw new Error(`Dataset discovery entry ${index} is invalid`);
    }
    const manifest = parseContributionManifest(entry.manifest);
    if (manifest.model.dtype !== entry.modelVariant) {
      throw new Error(
        `Dataset discovery entry ${index} has a model variant that does not match its manifest`,
      );
    }
    return {
      id: entry.id,
      modelKey: entry.modelKey,
      modelVariant: entry.modelVariant,
      format: entry.format,
      path: entry.path,
      manifest,
    };
  });

  return { schemaVersion: DATASET_CATALOG_SCHEMA_VERSION, datasets };
}

export async function loadDatasetCatalog(
  dataBaseUrl: string,
  signal?: AbortSignal,
): Promise<RemoteDataset[]> {
  const root = new URL(
    dataBaseUrl.endsWith('/') ? dataBaseUrl : `${dataBaseUrl}/`,
    document.baseURI,
  );
  const response = await fetch(new URL('manifest.json', root), { signal });
  if (!response.ok) {
    throw new Error(
      `Could not load dataset discovery manifest: ${response.status} ${response.statusText}`,
    );
  }
  const catalog = parseDatasetCatalog(await response.json());
  return catalog.datasets.filter(matchesModelConfiguration).map((entry) => ({
    ...entry,
    baseUrl: new URL(
      entry.path.endsWith('/') ? entry.path : `${entry.path}/`,
      root,
    ).href,
  }));
}
