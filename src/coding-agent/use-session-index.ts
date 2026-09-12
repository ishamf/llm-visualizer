import { useEffect, useState } from 'react';

import { parseSessionIndex, type SessionIndex } from './session-index.ts';
import { sessionIndexUrl } from './session-urls.ts';

export type SessionIndexState =
  | { status: 'loading' }
  | { status: 'ready'; index: SessionIndex }
  | { status: 'error'; error: Error };

export function useSessionIndex(): SessionIndexState {
  const [state, setState] = useState<SessionIndexState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetch(sessionIndexUrl(), { signal: controller.signal })
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
  }, []);

  return state;
}
