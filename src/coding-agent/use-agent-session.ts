import { useEffect, useState } from 'react';

import { parsePackedSession, type PackedSession } from './packed-session.ts';
import { buildTimeline, type Timeline } from './timeline.ts';

export type AgentSessionState =
  | { status: 'loading' }
  | { status: 'ready'; session: PackedSession; timeline: Timeline }
  | { status: 'error'; error: Error };

export function useAgentSession(url: string): AgentSessionState {
  const [state, setState] = useState<AgentSessionState>({ status: 'loading' });

  useEffect(() => {
    // The caller remounts on session change, so a new hook instance always
    // starts from the loading state.
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `Could not load the coding agent session: ${response.status} ${response.statusText}`,
          );
        }
        return parsePackedSession(await response.json());
      })
      .then(
        (session) =>
          setState({
            status: 'ready',
            session,
            timeline: buildTimeline(session),
          }),
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
  }, [url]);

  return state;
}
