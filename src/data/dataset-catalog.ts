import { MODEL_CONFIGURATION } from '../generation/config.ts';
import type {
  ContributionFormat,
  ContributionManifest,
} from '../generation/types.ts';
import { parseContributionManifest } from './contribution-data-source.ts';

export const DATASET_CATALOG_SCHEMA_VERSION = 4 as const;
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

type CatalogDatasetEntry = Omit<
  DatasetCatalogEntry,
  'modelKey' | 'modelVariant' | 'format'
>;

export type DatasetCatalog = {
  schemaVersion: typeof DATASET_CATALOG_SCHEMA_VERSION;
  modelKey: string;
  modelVariant: string;
  format: ContributionFormat;
  datasets: CatalogDatasetEntry[];
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
    typeof value.modelKey !== 'string' ||
    value.modelKey.length === 0 ||
    typeof value.modelVariant !== 'string' ||
    value.modelVariant.length === 0 ||
    (value.format !== 'layered' && value.format !== 'summed') ||
    !Array.isArray(value.datasets)
  ) {
    throw new Error('Dataset discovery manifest has an unsupported shape');
  }

  const datasets = value.datasets.map((entry, index): CatalogDatasetEntry => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      entry.id.length === 0 ||
      typeof entry.path !== 'string' ||
      entry.path.length === 0 ||
      entry.path.startsWith('/') ||
      entry.path.includes('..')
    ) {
      throw new Error(`Dataset discovery entry ${index} is invalid`);
    }
    const manifest = parseContributionManifest(entry.manifest);
    if (manifest.model.dtype !== value.modelVariant) {
      throw new Error(
        `Dataset discovery entry ${index} has a model variant that does not match its manifest`,
      );
    }
    return {
      id: entry.id,
      path: entry.path,
      manifest,
    };
  });

  return {
    schemaVersion: DATASET_CATALOG_SCHEMA_VERSION,
    modelKey: value.modelKey,
    modelVariant: value.modelVariant,
    format: value.format,
    datasets,
  };
}

const CATALOG_LOCATIONS = [
  { directory: 'contributions', format: 'layered' },
  { directory: 'summed-contributions', format: 'summed' },
] as const satisfies readonly {
  directory: string;
  format: ContributionFormat;
}[];

export async function loadDatasetCatalog(
  dataBaseUrl: string,
  signal?: AbortSignal,
): Promise<RemoteDataset[]> {
  const root = new URL(
    dataBaseUrl.endsWith('/') ? dataBaseUrl : `${dataBaseUrl}/`,
    document.baseURI,
  );
  const catalogs = await Promise.all(
    CATALOG_LOCATIONS.map(async ({ directory, format }) => {
      const catalogUrl = new URL(
        `${directory}/${MODEL_CONFIGURATION.key}/${MODEL_CONFIGURATION.variant}/manifest.json`,
        root,
      );
      const response = await fetch(catalogUrl, { signal });
      if (response.status === 404) return undefined;
      if (!response.ok) {
        throw new Error(
          `Could not load dataset discovery manifest: ${response.status} ${response.statusText}`,
        );
      }
      const catalog = parseDatasetCatalog(await response.json());
      if (
        catalog.modelKey !== MODEL_CONFIGURATION.key ||
        catalog.modelVariant !== MODEL_CONFIGURATION.variant ||
        catalog.format !== format
      ) {
        throw new Error(
          'Dataset discovery manifest does not match its configured model, variant, and format',
        );
      }
      return { catalog, catalogUrl };
    }),
  );
  const availableCatalogs = catalogs.filter(
    (catalog): catalog is NonNullable<typeof catalog> => catalog !== undefined,
  );
  if (availableCatalogs.length === 0) {
    throw new Error('Could not load any dataset discovery manifests');
  }
  return availableCatalogs.flatMap(({ catalog, catalogUrl }) =>
    catalog.datasets.map((entry) => ({
      ...entry,
      modelKey: catalog.modelKey,
      modelVariant: catalog.modelVariant,
      format: catalog.format,
      baseUrl: new URL(
        entry.path.endsWith('/') ? entry.path : `${entry.path}/`,
        catalogUrl,
      ).href,
    })),
  );
}
