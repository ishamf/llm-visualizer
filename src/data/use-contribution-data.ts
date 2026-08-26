import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ContributionLayer,
  ContributionManifest,
} from '../generation/types.ts';
import type { ContributionDataSource } from './contribution-data-source.ts';

type ManifestState =
  | { status: 'loading' }
  | { status: 'ready'; manifest: ContributionManifest }
  | { status: 'error'; error: Error };

export function useContributionData(
  source: ContributionDataSource,
  initialManifest?: ContributionManifest,
) {
  const [manifestState, setManifestState] = useState<ManifestState>(() =>
    initialManifest
      ? { status: 'ready', manifest: initialManifest }
      : { status: 'loading' },
  );
  const [layers, setLayers] = useState<Map<number, ContributionLayer>>(
    () => new Map(),
  );
  const [layerErrors, setLayerErrors] = useState<Map<number, Error>>(
    () => new Map(),
  );
  const pendingLayers = useRef(new Map<number, Promise<ContributionLayer>>());

  useEffect(() => {
    if (initialManifest) return;
    const controller = new AbortController();
    const pending = pendingLayers.current;

    void source.getManifest(controller.signal).then(
      (manifest) => setManifestState({ status: 'ready', manifest }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setManifestState({
            status: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      },
    );
    return () => {
      controller.abort();
      pending.clear();
    };
  }, [initialManifest, source]);

  const loadLayer = useCallback(
    (layer: number) => {
      const loaded = layers.get(layer);
      if (loaded) return Promise.resolve(loaded);
      const pending = pendingLayers.current.get(layer);
      if (pending) return pending;

      const request = source.getLayer(layer).then(
        (value) => {
          setLayers((current) => new Map(current).set(layer, value));
          setLayerErrors((current) => {
            if (!current.has(layer)) return current;
            const next = new Map(current);
            next.delete(layer);
            return next;
          });
          return value;
        },
        (error: unknown) => {
          const resolved =
            error instanceof Error ? error : new Error(String(error));
          setLayerErrors((current) => new Map(current).set(layer, resolved));
          throw resolved;
        },
      );
      pendingLayers.current.set(layer, request);
      void request.then(
        () => pendingLayers.current.delete(layer),
        () => pendingLayers.current.delete(layer),
      );
      return request;
    },
    [layers, source],
  );

  return { manifestState, layers, layerErrors, loadLayer };
}
