import { memo, useMemo } from 'react';

import { formatCost } from '../coding-agent/format.ts';
import type {
  PackedSession,
  PackedUsage,
  PackedUsageCost,
} from '../coding-agent/packed-session.ts';
import {
  ChartBody,
  ChartLegend,
  type CostCategory,
  type RequestCostRow,
} from './CostChartParts.tsx';
import styles from './CostChartParts.module.css';

/** Cost categories stacked in each bar, bottom to top. Cache write is not
 * charted: recorded sessions carry none, so the category would only add a
 * dead legend entry. */
const REQUEST_CATEGORIES: ReadonlyArray<CostCategory<RequestCostRow>> = [
  { key: 'cached', label: 'Cached' },
  { key: 'input', label: 'Input' },
  { key: 'output', label: 'Output' },
];

type PriceCategoryKey = 'cached' | 'input' | 'output';

/** The charted categories with the usage fields their per-token price
 * derives from. */
const PRICE_CATEGORIES: ReadonlyArray<{
  key: PriceCategoryKey;
  tokens: (usage: PackedUsage) => number;
  cost: (cost: PackedUsageCost | undefined) => number;
}> = [
  {
    key: 'cached',
    tokens: (usage) => usage.cacheRead,
    cost: (cost) => cost?.cacheRead ?? 0,
  },
  {
    key: 'input',
    tokens: (usage) => usage.input,
    cost: (cost) => cost?.input ?? 0,
  },
  {
    key: 'output',
    tokens: (usage) => usage.output,
    cost: (cost) => cost?.output ?? 0,
  },
];

/** Width of the cached segment; the others scale from it, shrinking when
 * the total would outgrow the legend row. */
const PRICE_BASE_PX = 5;
const PRICE_MAX_TOTAL_PX = 240;
/** Floor for the shrunken reference and for any single segment. */
const PRICE_MIN_PX = 2;

type PriceItem = { key: PriceCategoryKey; width: number };

/**
 * Segment widths of the legend's relative-price bar: each segment is as
 * wide as the category's per-token price is times the cached one
 * (accumulated cost over accumulated tokens), with cached as the
 * `PRICE_BASE_PX` reference — the same linear scale the chart's bars
 * themselves use. The reference shrinks when the total would outgrow the
 * legend; categories without a positive rate are omitted.
 */
function relativePriceItems(session: PackedSession): PriceItem[] {
  const tokens: Record<PriceCategoryKey, number> = {
    cached: 0,
    input: 0,
    output: 0,
  };
  const costs: Record<PriceCategoryKey, number> = {
    cached: 0,
    input: 0,
    output: 0,
  };
  for (const { data } of session.requests) {
    const usage = data.response.usage;
    const cost = usage.cost;
    for (const {
      key,
      tokens: readTokens,
      cost: readCost,
    } of PRICE_CATEGORIES) {
      tokens[key] += readTokens(usage);
      costs[key] += readCost(cost);
    }
  }
  const rates = Object.fromEntries(
    PRICE_CATEGORIES.map(({ key }) => [
      key,
      tokens[key] > 0 ? costs[key] / tokens[key] : 0,
    ]),
  ) as Record<PriceCategoryKey, number>;
  const reference =
    rates.cached > 0
      ? rates.cached
      : Math.min(...Object.values(rates).filter((rate) => rate > 0));
  if (!(reference > 0)) return [];
  const relatives = PRICE_CATEGORIES.map(({ key }) => rates[key] / reference);
  const relativeTotal = relatives.reduce((sum, rate) => sum + rate, 0);
  const base =
    relativeTotal * PRICE_BASE_PX > PRICE_MAX_TOTAL_PX
      ? Math.max(PRICE_MIN_PX, PRICE_MAX_TOTAL_PX / relativeTotal)
      : PRICE_BASE_PX;
  return PRICE_CATEGORIES.flatMap(({ key }, index) =>
    relatives[index] > 0
      ? [
          {
            key,
            width: Math.max(PRICE_MIN_PX, Math.round(base * relatives[index])),
          },
        ]
      : [],
  );
}

/** Whether each bar shows its request's own cost, or the session's running
 * total after it. */
export type RequestCostChartVariant = 'per-request' | 'cumulative';

/**
 * The coding agent page's cost charts: one stacked bar per provider request,
 * in the order the requests were sent, with cached at the bottom. No context
 * allocation — just what each request cost, straight from its recorded
 * usage. With `variant="cumulative"` bar n stacks the session's running
 * total after request n instead of that request's own cost, so the bars are
 * directly comparable between the two variants.
 */
// Memoized: the page re-renders at 60fps during playback while `session` is
// stable, and a re-render walks the chart's ~1000 SVG nodes for nothing.
export const RequestCostChart = memo(function RequestCostChart({
  session,
  variant = 'per-request',
  showDescription = true,
}: {
  session: PackedSession;
  variant?: RequestCostChartVariant;
  /** The description line states the chart's reading and the session
   * total; embeds that supply their own copy can drop it. */
  showDescription?: boolean;
}) {
  const cumulative = variant === 'cumulative';
  const rows = useMemo<RequestCostRow[]>(() => {
    const running = { cached: 0, input: 0, output: 0 };
    return session.requests.map(({ data }, index) => {
      const cost = data.response.usage.cost;
      if (cumulative) {
        running.cached += cost?.cacheRead ?? 0;
        running.input += cost?.input ?? 0;
        running.output += cost?.output ?? 0;
      }
      const values = cumulative
        ? { ...running }
        : {
            cached: cost?.cacheRead ?? 0,
            input: cost?.input ?? 0,
            output: cost?.output ?? 0,
          };
      return {
        request: index + 1,
        ...values,
        // The bar's total; summing the charted components keeps it
        // consistent with the segments actually drawn.
        total: values.cached + values.input + values.output,
      };
    });
  }, [session, cumulative]);
  // The session total — the sum of the raw per-request costs. For the
  // cumulative rows summing `row.total` would re-accumulate the running
  // sums; the last row's total is the same number, but this holds for both
  // variants.
  const total = session.requests.reduce((sum, { data }) => {
    const cost = data.response.usage.cost;
    return (
      sum + (cost?.cacheRead ?? 0) + (cost?.input ?? 0) + (cost?.output ?? 0)
    );
  }, 0);
  // The relative-price bar illustrates the session's per-token prices, which
  // are the same either way; it stays on the per-request chart only.
  const priceItems = useMemo(
    () => (cumulative ? [] : relativePriceItems(session)),
    [cumulative, session],
  );
  return (
    <section
      className={styles.chartSection}
      aria-label={
        cumulative ? 'Cumulative cost per request' : 'Cost per request'
      }
    >
      <h2 className={styles.chartTitle}>
        {cumulative ? 'Cumulative cost per request' : 'Cost per request'}
      </h2>
      {showDescription && (
        <p className={styles.chartDescription}>
          {cumulative ? (
            <>
              The session’s cost as it accumulates, request by request — the
              same cached, input, and output segments stacked on top of each
              other. The session ends at {formatCost(total)}.
            </>
          ) : (
            <>
              Each request’s cost — cached, input, and output — as one bar, in
              the order the requests were sent. The session total is{' '}
              {formatCost(total)}.
            </>
          )}
        </p>
      )}
      <div className={styles.chartFigure}>
        <ChartBody
          rows={rows}
          categories={REQUEST_CATEGORIES}
          xKey="request"
          xTickFormatter={(value) => String(value)}
          xAxisLabel="request"
          barCategoryGap="25%"
          maxBarSize={48}
          ariaLabel={
            cumulative
              ? 'Stacked bar chart of cumulative cost per provider request'
              : 'Stacked bar chart of cost per provider request'
          }
          tooltipTitle={(row) =>
            cumulative
              ? `Request ${row.request}: ${formatCost(row.total)} spent so far`
              : `Request ${row.request}: ${formatCost(row.total)}`
          }
        />
        <ChartLegend categories={REQUEST_CATEGORIES}>
          {!cumulative && priceItems.length > 0 && (
            <RelativePrices items={priceItems} />
          )}
        </ChartLegend>
      </div>
    </section>
  );
});

/** The legend's right-side illustration of the relative per-token prices:
 * one stacked bar, its segments as wide as each category's price relative
 * to cached, colored per the legend. */
function RelativePrices({ items }: { items: PriceItem[] }) {
  return (
    <div
      className={styles.relativePrices}
      title="Segment widths are proportional to each category’s per-token price."
    >
      <span>Relative prices</span>
      <div className={styles.priceBar}>
        {items.map(({ key, width }) => (
          <span
            key={key}
            className={`${styles.priceSegment} ${styles[key]}`}
            style={{ width }}
          />
        ))}
      </div>
    </div>
  );
}
