import { useEffect, useState } from 'react';

import { GENERATED_DATA_BASE_URL } from '../data/dataset-catalog.ts';
import { parseSessionIndex, type SessionIndex } from './session-index.ts';
import { sessionIndexUrl } from './session-urls.ts';

export type SessionIndexState =
  | { status: 'loading' }
  | { status: 'ready'; index: SessionIndex }
  | { status: 'error'; error: Error };

export function useSessionIndex(
  generatedDataBaseUrl: string = GENERATED_DATA_BASE_URL,
): SessionIndexState {
  const [state, setState] = useState<SessionIndexState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetch(sessionIndexUrl(generatedDataBaseUrl), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `Could not load the session index: ${response.status} ${response.statusText}`,
          );
        }
        return parseSessionIndex(await response.json());
      })
      .then(
        (index) => setState({ status: 'ready', index }),
        (error: unknown) => {
          if (!controller.signal.aborted) {
            setState({
              status: 'error',
              error: error instanceof Error ? error : new Error(String(error)),
            });
          }
        },
      );
    return () => controller.abort();
  }, [generatedDataBaseUrl]);

  return state;
}
