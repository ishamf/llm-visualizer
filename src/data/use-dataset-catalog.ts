import { useEffect, useState } from 'react';

import { loadDatasetCatalog, type RemoteDataset } from './dataset-catalog.ts';

type DatasetCatalogState =
  | { status: 'loading'; datasets: readonly [] }
  | { status: 'ready'; datasets: readonly RemoteDataset[] }
  | { status: 'error'; datasets: readonly []; error: Error };

type StoredDatasetCatalogState = DatasetCatalogState & { dataBaseUrl: string };

export function useDatasetCatalog(dataBaseUrl: string): DatasetCatalogState {
  const [state, setState] = useState<StoredDatasetCatalogState>({
    status: 'loading',
    datasets: [],
    dataBaseUrl,
  });

  useEffect(() => {
    const controller = new AbortController();
    void loadDatasetCatalog(dataBaseUrl, controller.signal).then(
      (datasets) => setState({ status: 'ready', datasets, dataBaseUrl }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            status: 'error',
            datasets: [],
            error: error instanceof Error ? error : new Error(String(error)),
            dataBaseUrl,
          });
        }
      },
    );
    return () => controller.abort();
  }, [dataBaseUrl]);

  return state.dataBaseUrl === dataBaseUrl
    ? state
    : { status: 'loading', datasets: [] };
}
