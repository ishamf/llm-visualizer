import {
  Alert,
  Button,
  Container,
  Group,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  CONTEXT_COST_BUCKET_TOKENS,
  CONTEXT_COST_WINDOW_BUCKET_TOKENS,
  CONTEXT_COST_WINDOW_TOKENS,
  contextCostSeries,
  contextCostWindowSeries,
} from '../coding-agent/context-cost.ts';
import {
  formatCost,
  formatKiloTokens as kilo,
} from '../coding-agent/format.ts';
import type { PackedSession } from '../coding-agent/packed-session.ts';
import type { SessionIndexEntry } from '../coding-agent/session-index.ts';
import { sessionUrl } from '../coding-agent/session-urls.ts';
import { useAgentSession } from '../coding-agent/use-agent-session.ts';
import { useSessionIndex } from '../coding-agent/use-session-index.ts';
import { GENERATED_DATA_BASE_URL } from '../data/dataset-catalog.ts';
import shared from '../shared.module.css';
import {
  ChartBody,
  ChartLegend,
  type ContextCostRow,
  type CostCategory,
} from './CostChartParts.tsx';
import styles from './CostChartParts.module.css';

/** Cost categories stacked in each context bar, bottom to top. */
const CONTEXT_CATEGORIES: ReadonlyArray<CostCategory<ContextCostRow>> = [
  { key: 'cached', label: 'Cached read' },
  { key: 'cacheWrite', label: 'Cache write' },
  { key: 'input', label: 'Input' },
  { key: 'output', label: 'Output' },
];

/** Cost of each context slice: only the tokens that slice owns. */
export function ContextCostChart({ session }: { session: PackedSession }) {
  const series = useMemo(() => contextCostSeries(session), [session]);
  if (series.contextTokens === 0) return null;
  return (
    <section className={styles.chartSection} aria-label="Cost over context">
      <h2 className={styles.chartTitle}>Cost over context</h2>
      <p className={styles.chartDescription}>
        Each request’s full cost — input, cached read, cache write, and output —
        spread over the context tokens it ingested and generated, per{' '}
        {CONTEXT_COST_BUCKET_TOKENS.toLocaleString('en-US')} tokens.
      </p>
      <div className={styles.chartFigure}>
        <ChartBody
          rows={series.buckets.map(({ start, end, costs }) => ({
            start,
            end,
            ...costs,
          }))}
          categories={CONTEXT_CATEGORIES}
          ariaLabel={`Stacked bar chart of allocated cost per ${CONTEXT_COST_BUCKET_TOKENS} context tokens`}
          tooltipTitle={(row) =>
            `${kilo(row.start)}–${kilo(row.end)} tokens: ${formatCost(row.total)}`
          }
        />
        <ChartLegend categories={CONTEXT_CATEGORIES} />
      </div>
    </section>
  );
}

/**
 * Rolling-window companion: for each slice, the total cost of the trailing
 * window of context ending at it — the slice itself plus the preceding
 * tokens. Same price allocation as the per-slice chart, viewed through a
 * wide window that smooths its per-request spikes.
 */
export function ContextCostWindowChart({
  session,
}: {
  session: PackedSession;
}) {
  const series = useMemo(() => contextCostWindowSeries(session), [session]);
  if (series.contextTokens === 0) return null;
  const extraTokens =
    CONTEXT_COST_WINDOW_TOKENS - CONTEXT_COST_WINDOW_BUCKET_TOKENS;
  return (
    <section className={styles.chartSection} aria-label="Rolling context cost">
      <h2 className={styles.chartTitle}>
        Cost of the last {CONTEXT_COST_WINDOW_TOKENS.toLocaleString('en-US')}{' '}
        tokens
      </h2>
      <p className={styles.chartDescription}>
        For each {CONTEXT_COST_WINDOW_BUCKET_TOKENS.toLocaleString('en-US')}
        -token slice of the context, the total cost of the{' '}
        {CONTEXT_COST_WINDOW_TOKENS.toLocaleString('en-US')} tokens ending there
        — the slice itself plus the {extraTokens.toLocaleString('en-US')} before
        it, at the same per-request prices. The trailing window smooths the
        per-request spikes of the per-slice chart.
      </p>
      <div className={styles.chartFigure}>
        <ChartBody
          rows={series.buckets.map(({ start, end, windowStart, costs }) => ({
            start,
            end,
            windowStart,
            ...costs,
          }))}
          categories={CONTEXT_CATEGORIES}
          ariaLabel={`Stacked bar chart of the cost of the last ${CONTEXT_COST_WINDOW_TOKENS} context tokens, per ${CONTEXT_COST_WINDOW_BUCKET_TOKENS}-token slice`}
          tooltipTitle={(row) =>
            `${kilo(row.start)}–${kilo(row.end)} tokens: ${formatCost(row.total)} (window ${kilo(row.windowStart ?? 0)}–${kilo(row.end)})`
          }
        />
        <ChartLegend categories={CONTEXT_CATEGORIES} />
      </div>
    </section>
  );
}

/**
 * Dev-only companion page for the coding agent replay: the cost-over-context
 * charts that used to render below the playback bar. The published page shows
 * only the simpler per-request chart; these allocation views stay available
 * for checking the context-cost model. Not linked from the homepage — open
 * `/dev/coding-agent-charts` directly; production builds redirect home.
 */
export function DevCodingAgentChartsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const index = useSessionIndex(GENERATED_DATA_BASE_URL);

  let body: ReactNode;
  if (index.status === 'loading') {
    body = <Text c="dimmed">Loading the coding agent sessions…</Text>;
  } else if (index.status === 'error') {
    body = (
      <Alert color="red" title="Sessions unavailable">
        {index.error.message}
      </Alert>
    );
  } else {
    const sessions = index.index.sessions;
    const selected =
      sessions.find(({ id }) => id === searchParams.get('session')) ??
      sessions[0];
    body =
      selected === undefined ? (
        <Alert color="red" title="Sessions unavailable">
          No coding agent sessions were found in the session index.
        </Alert>
      ) : (
        <>
          {sessions.length > 1 && (
            <Select
              label="Session"
              description={selected.info.description}
              data={sessions.map(({ id, info }) => ({
                value: id,
                label: info.title,
              }))}
              value={selected.id}
              onChange={(id) => {
                if (id)
                  setSearchParams(id === sessions[0].id ? {} : { session: id });
              }}
              allowDeselect={false}
              maw={420}
            />
          )}
          <SessionCharts selected={selected} />
        </>
      );
  }

  return (
    <main className={shared.appShell}>
      <Container size="xl">
        <Group gap="xs">
          <Button
            component={Link}
            to="/coding-agent"
            variant="subtle"
            size="compact-sm"
            className={shared.backLink}
          >
            ← Back to the coding agent
          </Button>
          <Button
            component={Link}
            to="/"
            variant="subtle"
            size="compact-sm"
            className={shared.backLink}
          >
            ← Back to homepage
          </Button>
        </Group>
        <header>
          <Text className={shared.eyebrow}>Coding agent · developer tools</Text>
          <Title order={1}>Cost over context</Title>
          <Text c="dimmed" maw={720} mb="md">
            Cost-allocation views for a recorded coding agent session: how each
            request’s cost spreads over the context it ingested and generated.
            The coding agent page itself shows only the simpler cost-per-request
            chart.
          </Text>
        </header>
        <Stack gap="md">{body}</Stack>
      </Container>
    </main>
  );
}

function SessionCharts({ selected }: { selected: SessionIndexEntry }) {
  const session = useAgentSession(
    sessionUrl(selected, GENERATED_DATA_BASE_URL),
  );
  if (session.status === 'loading') {
    return <Text c="dimmed">Loading the coding agent session…</Text>;
  }
  if (session.status === 'error') {
    return (
      <Alert color="red" title="Session unavailable">
        {session.error.message}
      </Alert>
    );
  }
  return (
    <>
      <ContextCostChart session={session.session} />
      <ContextCostWindowChart session={session.session} />
    </>
  );
}
