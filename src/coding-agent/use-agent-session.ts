import { useEffect, useState } from 'react';

import { GENERATED_DATA_BASE_URL } from '../data/dataset-catalog.ts';
import { parsePackedSession, type PackedSession } from './packed-session.ts';
import { buildTimeline, type Timeline } from './timeline.ts';

export type AgentSessionState =
  | { status: 'loading' }
  | { status: 'ready'; session: PackedSession; timeline: Timeline }
  | { status: 'error'; error: Error };

const SESSION_URL = `${GENERATED_DATA_BASE_URL}coding-agent/session.json`;

export function useAgentSession(): AgentSessionState {
  const [state, setState] = useState<AgentSessionState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetch(SESSION_URL, { signal: controller.signal })
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
  }, []);

  return state;
}
