import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  CONTEXT_COST_BUCKET_TOKENS,
  CONTEXT_COST_WINDOW_BUCKET_TOKENS,
  CONTEXT_COST_WINDOW_TOKENS,
  contextCostSeries,
  contextCostWindowSeries,
  type ContextCostBucket,
} from '../coding-agent/context-cost.ts';
import { formatCost } from '../coding-agent/format.ts';
import type { PackedSession } from '../coding-agent/packed-session.ts';
import styles from './ContextCostChart.module.css';

/** Cost categories stacked in each bar, bottom to top. */
const STACKED_CATEGORIES: Array<{
  key: 'cached' | 'cacheWrite' | 'input' | 'output';
  label: string;
}> = [
  { key: 'cached', label: 'Cached read' },
  { key: 'cacheWrite', label: 'Cache write' },
  { key: 'input', label: 'Input' },
  { key: 'output', label: 'Output' },
];

type Costs = ContextCostBucket['costs'];

/** One chart row: bucket position plus its stacked cost values. */
type CostRow = {
  start: number;
  end: number;
  /** First context token of the trailing window (rolling chart only). */
  windowStart?: number;
} & Costs;

const kilo = (tokens: number) => `${Math.round(tokens / 1000)}k`;

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
          ariaLabel={`Stacked bar chart of allocated cost per ${CONTEXT_COST_BUCKET_TOKENS} context tokens`}
          tooltipTitle={(row) =>
            `${kilo(row.start)}–${kilo(row.end)} tokens: ${formatCost(row.total)}`
          }
        />
        <ChartLegend />
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
          ariaLabel={`Stacked bar chart of the cost of the last ${CONTEXT_COST_WINDOW_TOKENS} context tokens, per ${CONTEXT_COST_WINDOW_BUCKET_TOKENS}-token slice`}
          tooltipTitle={(row) =>
            `${kilo(row.start)}–${kilo(row.end)} tokens: ${formatCost(row.total)} (window ${kilo(row.windowStart ?? 0)}–${kilo(row.end)})`
          }
        />
        <ChartLegend />
      </div>
    </section>
  );
}

function ChartBody({
  rows,
  ariaLabel,
  tooltipTitle,
}: {
  rows: CostRow[];
  ariaLabel: string;
  tooltipTitle: (row: CostRow) => string;
}) {
  // At most eight x labels.
  const labelInterval = Math.max(0, Math.ceil(rows.length / 8) - 1);

  return (
    <div className={styles.chart} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          barCategoryGap={1}
          barGap={0}
          accessibilityLayer
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="start"
            tickFormatter={kilo}
            interval={labelInterval}
            tickLine={false}
            axisLine
            height={36}
            label={{
              value: 'context tokens',
              position: 'insideBottom',
              dy: 10,
            }}
          />
          <YAxis
            tickFormatter={formatCost}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <Tooltip
            content={<CostTooltip title={tooltipTitle} />}
            cursor={{ opacity: 0.08 }}
          />
          {STACKED_CATEGORIES.map(({ key }) => (
            <Bar
              key={key}
              dataKey={key}
              stackId="cost"
              className={styles[key]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

type CostTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload?: CostRow }>;
  title: (row: CostRow) => string;
};

function CostTooltip({ active, payload, title }: CostTooltipProps) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>{title(row)}</div>
      {STACKED_CATEGORIES.filter(({ key }) => row[key] > 0).map(
        ({ key, label }) => (
          <div key={key}>
            {label} {formatCost(row[key])}
          </div>
        ),
      )}
    </div>
  );
}

function ChartLegend() {
  return (
    <div className={styles.chartLegend}>
      {STACKED_CATEGORIES.map(({ key, label }) => (
        <span className={styles.legendItem} key={key}>
          <span
            className={`${styles.legendSwatch} ${styles[key]}`}
            aria-hidden="true"
          />
          {label}
        </span>
      ))}
    </div>
  );
}
