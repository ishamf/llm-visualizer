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
  contextCostSeries,
  type ContextCostSeries,
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

const kilo = (tokens: number) => `${Math.round(tokens / 1000)}k`;

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
      <ChartBody series={series} />
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
    </section>
  );
}

function ChartBody({ series }: { series: ContextCostSeries }) {
  const rows = series.buckets.map((bucket) => ({
    start: bucket.start,
    end: bucket.end,
    ...bucket.costs,
  }));
  // At most eight x labels.
  const labelInterval = Math.max(0, Math.ceil(series.buckets.length / 8) - 1);

  return (
    <div
      className={styles.chart}
      role="img"
      aria-label="Stacked bar chart of allocated cost per 1000 context tokens"
    >
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
          <Tooltip content={<CostTooltip />} cursor={{ opacity: 0.08 }} />
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
  payload?: Array<{
    payload?: { start: number; end: number; total: number } & Record<
      string,
      number
    >;
  }>;
};

function CostTooltip({ active, payload }: CostTooltipProps) {
  const bucket = active ? payload?.[0]?.payload : undefined;
  if (!bucket) return null;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>
        {kilo(bucket.start)}–{kilo(bucket.end)} tokens:{' '}
        {formatCost(bucket.total)}
      </div>
      {STACKED_CATEGORIES.filter(({ key }) => bucket[key] > 0).map(
        ({ key, label }) => (
          <div key={key}>
            {label} {formatCost(bucket[key])}
          </div>
        ),
      )}
    </div>
  );
}
