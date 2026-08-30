import { UI_MODEL_KEY } from '../generation/config.ts';
import type {
  ContributionFormat,
  ContributionManifest,
} from '../generation/types.ts';
import { parseContributionManifest } from './contribution-data-source.ts';

export const DATASET_CATALOG_SCHEMA_VERSION = 1 as const;
export const GENERATED_DATA_BASE_URL =
  import.meta.env.VITE_GENERATED_DATA_BASE_URL || '/generated/';

export type DatasetCatalogEntry = {
  id: string;
  modelKey: string;
  format: ContributionFormat;
  path: string;
  manifest: ContributionManifest;
};

export type DatasetCatalog = {
  schemaVersion: typeof DATASET_CATALOG_SCHEMA_VERSION;
  datasets: DatasetCatalogEntry[];
};

export type RemoteDataset = DatasetCatalogEntry & { baseUrl: string };

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
      (entry.format !== 'layered' && entry.format !== 'summed') ||
      typeof entry.path !== 'string' ||
      entry.path.length === 0 ||
      entry.path.startsWith('/') ||
      entry.path.includes('..')
    ) {
      throw new Error(`Dataset discovery entry ${index} is invalid`);
    }
    return {
      id: entry.id,
      modelKey: entry.modelKey,
      format: entry.format,
      path: entry.path,
      manifest: parseContributionManifest(entry.manifest),
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
  return catalog.datasets
    .filter(({ modelKey }) => modelKey === UI_MODEL_KEY)
    .map((entry) => ({
      ...entry,
      baseUrl: new URL(
        entry.path.endsWith('/') ? entry.path : `${entry.path}/`,
        root,
      ).href,
    }));
}
