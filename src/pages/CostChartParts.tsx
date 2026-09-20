import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  useActiveTooltipDataPoints,
} from 'recharts';

import type { ContextCostBucket } from '../coding-agent/context-cost.ts';
import { formatCost, formatKiloTokens } from '../coding-agent/format.ts';
import styles from './CostChartParts.module.css';

/** Cost values charted per row, as recorded per coding agent request. */
export type Costs = ContextCostBucket['costs'];

/** One context chart row: bucket position plus its stacked cost values. */
export type ContextCostRow = {
  /** First context token of the bucket. */
  start: number;
  /** One past the last context token of the bucket. */
  end: number;
  /** First context token of the trailing window (rolling chart only). */
  windowStart?: number;
} & Costs;

/** One per-request chart row: the request number plus its cost values. */
export type RequestCostRow = {
  /** 1-based request number, matching the request list labels. */
  request: number;
} & Pick<Costs, 'cached' | 'input' | 'output' | 'total'>;

export type CostRow = ContextCostRow | RequestCostRow;

/**
 * Row keys whose values are numbers — the fields that can stack as cost
 * categories. Excludes optional fields like the rolling window's
 * `windowStart`.
 */
type NumericRowKeys<Row> = {
  [K in keyof Row & string]: Row[K] extends number ? K : never;
}[keyof Row & string];

/** One stacked cost category, bottom to top. */
export type CostCategory<Row extends CostRow = CostRow> = {
  key: NumericRowKeys<Row>;
  label: string;
};

/** Text shown on the prompt marker preceding the hovered request. */
const PROMPT_MARKER_LABEL = {
  value: 'New prompt',
  position: 'insideTopLeft' as const,
  offset: 10,
};

/** The chart's prompt markers, isolated per the Recharts performance
 * guide's component-isolation pattern: the component subscribes to the
 * tooltip's active state through `useActiveTooltipDataPoints`, so hovering
 * re-renders only these markers while the rest of the chart stays
 * static. Rendered as a `BarChart` child; `ReferenceLine` resolves its own
 * coordinates from the chart context. */
function PromptMarkers({
  markers,
  xKey,
}: {
  markers: ReadonlyArray<number>;
  /** Row field plotted on the x axis. */
  xKey: 'start' | 'request';
}) {
  // Rows under the chart's tooltip, or undefined when nothing is hovered.
  const activePoints = useActiveTooltipDataPoints<CostRow>();
  // Category keys are numeric row fields (see `NumericRowKeys`), but the
  // generic lookup stays opaque to TS.
  const activeX =
    activePoints?.length && activePoints[0]
      ? ((activePoints[0] as unknown as Record<string, number | undefined>)[
          xKey
        ] ?? null)
      : null;
  // The marker preceding the hovered row — the prompt that produced it.
  let activeMarker: number | null = null;
  if (activeX != null) {
    for (const marker of markers) {
      if (marker <= activeX) activeMarker = marker;
      else break;
    }
  }
  return (
    <>
      {markers.map((marker) => (
        <ReferenceLine
          key={marker}
          x={marker}
          // On the category axis `start` is the marked bar's left band
          // edge — between the previous bar and the marked one.
          position="start"
          className={styles.promptMarker}
          label={marker === activeMarker ? PROMPT_MARKER_LABEL : false}
        />
      ))}
    </>
  );
}

/**
 * The shared stacked-bar chart body: one stack of `categories` per row,
 * with cost-formatted axes and a per-category tooltip. The x axis defaults
 * to the context charts' token positions; the per-request chart overrides
 * it. The first category stacks at the bottom of each bar.
 */
export function ChartBody<Row extends CostRow>({
  rows,
  categories,
  ariaLabel,
  tooltipTitle,
  markers,
  onBarClick,
  xKey = 'start',
  xTickFormatter = formatKiloTokens,
  xAxisLabel = 'context tokens',
  barCategoryGap = 1,
  maxBarSize,
}: {
  rows: Row[];
  /** Stacked cost categories, bottom to top. */
  categories: ReadonlyArray<CostCategory<Row>>;
  ariaLabel: string;
  tooltipTitle: (row: Row) => string;
  /** Row x values of vertical prompt markers, drawn as dashed lines at
   * each row's left band edge; none when omitted. While a row is hovered,
   * the marker preceding it is labeled "New prompt". */
  markers?: ReadonlyArray<number>;
  /** Called with the clicked bar's row; when set, bars show a pointer
   * cursor. The per-request charts use it to jump the session's replay to
   * the clicked request. */
  onBarClick?: (row: Row) => void;
  /** Row field plotted on the x axis. */
  xKey?: 'start' | 'request';
  /** X tick formatting; the context charts show token kilos. */
  xTickFormatter?: (value: number) => string;
  /** Label rendered under the x axis. */
  xAxisLabel?: string;
  /** Gap between neighboring bars; the context charts pack edge to edge. */
  barCategoryGap?: number | string;
  /** Cap on a single bar's width, for sessions with few bars. */
  maxBarSize?: number;
}) {
  // At most eight x labels.
  const labelInterval = Math.max(0, Math.ceil(rows.length / 8) - 1);

  return (
    <div
      className={
        onBarClick ? `${styles.chart} ${styles.clickableChart}` : styles.chart
      }
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          barCategoryGap={barCategoryGap}
          barGap={0}
          accessibilityLayer
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey={xKey}
            tickFormatter={xTickFormatter}
            interval={labelInterval}
            tickLine={false}
            axisLine
            // Tall enough for the tick labels plus the axis label below
            // them: `insideBottom` anchors the label's bottom edge inside
            // the axis box, an offset up from its bottom edge. (A plain
            // `dy` nudged the label past the SVG edge, clipping it.)
            height={44}
            label={{
              value: xAxisLabel,
              position: 'insideBottom',
              offset: 6,
            }}
          />
          <YAxis
            tickFormatter={formatCost}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <Tooltip
            content={
              <CostTooltip categories={categories} title={tooltipTitle} />
            }
            cursor={{ opacity: 0.08 }}
          />
          {markers && <PromptMarkers markers={markers} xKey={xKey} />}
          {categories.map(({ key }) => (
            <Bar
              key={key}
              // Read through a function: `NumericRowKeys<Row>` is a
              // numeric-valued key of `Row` by construction, but TS cannot
              // match the generic mapped type against Bar's typed dataKey.
              // Recharts resolves function keys like string keys.
              dataKey={(row: Row) => row[key] as number}
              stackId="cost"
              className={styles[key]}
              maxBarSize={maxBarSize}
              isAnimationActive={false}
              onClick={
                onBarClick
                  ? // Each stacked segment carries the same row.
                    (bar) => onBarClick(bar.payload as Row)
                  : undefined
              }
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

type CostTooltipProps<Row extends CostRow> = {
  active?: boolean;
  payload?: Array<{ payload?: Row }>;
  categories: ReadonlyArray<CostCategory<Row>>;
  title: (row: Row) => string;
};

function CostTooltip<Row extends CostRow>({
  active,
  payload,
  categories,
  title,
}: CostTooltipProps<Row>) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  const costOf = (key: NumericRowKeys<Row>): number => row[key] as number;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>{title(row)}</div>
      {categories
        .filter(({ key }) => costOf(key) > 0)
        .map(({ key, label }) => (
          <div key={key}>
            {label} {formatCost(costOf(key))}
          </div>
        ))}
    </div>
  );
}

export function ChartLegend({
  categories,
  children,
}: {
  categories: ReadonlyArray<{ key: string; label: string }>;
  /** Appended after the category items, inside the legend row. */
  children?: ReactNode;
}) {
  return (
    <div className={styles.chartLegend}>
      {categories.map(({ key, label }) => (
        <span className={styles.legendItem} key={key}>
          <span
            className={`${styles.legendSwatch} ${styles[key]}`}
            aria-hidden="true"
          />
          {label}
        </span>
      ))}
      {children}
    </div>
  );
}
