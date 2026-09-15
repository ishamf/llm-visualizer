import { Alert, Text } from '@mantine/core';

import { sessionIdUrl } from './coding-agent/session-urls.ts';
import { useAgentSession } from './coding-agent/use-agent-session.ts';
import { GENERATED_DATA_BASE_URL } from './data/dataset-catalog.ts';
import { RequestCostChart } from './pages/RequestCostChart.tsx';

/**
 * Router-free embed of the coding agent page's cost-per-request chart for
 * one session: loads the session's packed JSON and renders the chart, with
 * plain loading and error states. The standalone page feeds the chart from
 * its already-loaded replay session instead.
 */
export function RequestCostExperience({
  generatedDataBaseUrl = GENERATED_DATA_BASE_URL,
  sessionId,
  showDescription = true,
}: {
  /** Base URL of the generated data; the session loads from
   * `<base>coding-agent/<sessionId>/session.json`. */
  generatedDataBaseUrl?: string;
  /** Id of the session to chart (`coding-agent` by convention). */
  sessionId: string;
  /** Whether to render the chart's description line; embeds that supply
   * their own copy can drop it. */
  showDescription?: boolean;
}) {
  const state = useAgentSession(sessionIdUrl(sessionId, generatedDataBaseUrl));
  if (state.status === 'loading') {
    return <Text c="dimmed">Loading the session cost…</Text>;
  }
  if (state.status === 'error') {
    return (
      <Alert color="red" title="Session unavailable">
        {state.error.message}
      </Alert>
    );
  }
  return (
    <RequestCostChart
      session={state.session}
      showDescription={showDescription}
    />
  );
}
