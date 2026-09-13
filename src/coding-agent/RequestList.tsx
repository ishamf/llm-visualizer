import { Checkbox, Loader, Text } from '@mantine/core';
import { memo } from 'react';

import {
  formatBytes,
  formatCost,
  formatPricePerMillion,
  formatTokens,
} from './format.ts';
import {
  type RequestState,
  type RequestTimeline,
  type UsageBreakdown,
} from './timeline.ts';
import { usePinnedAutoScroll } from './use-pinned-scroll.ts';
import styles from './RequestList.module.css';

/**
 * How future (not yet sent) requests are presented: `hidden` omits them,
 * `peek` shows them temporarily after jumping to an earlier request, and
 * `shown` keeps them visible permanently.
 */
export type FutureRequestsMode = 'hidden' | 'peek' | 'shown';

type RequestCardProps = {
  request: RequestTimeline;
  status: RequestState['status'];
  /**
   * Presents an in-flight request (`processing`/`streaming`) in the settled
   * style: payload bytes and usage with the spinner in the checkmark's
   * place. Used while future requests are visible, so seeking across a
   * request's window does not flip its card between presentations.
   */
  settledPending: boolean;
  onRequestClick: (request: RequestTimeline) => void;
};

const RequestCard = memo(function RequestCard({
  request,
  status,
  settledPending,
  onRequestClick,
}: RequestCardProps) {
  const usage = request.usage;
  const settled = status === 'done' || status === 'future' || settledPending;
  return (
    <button
      type="button"
      className={styles.requestCard}
      data-status={status}
      onClick={() => onRequestClick(request)}
      aria-label={`Pause and seek to when request ${request.index} completed`}
    >
      <span className={styles.requestHeader}>
        <span className={styles.requestIndex}>#{request.index}</span>
        {settled ? (
          <span className={styles.requestBytes} title="UTF-8 JSON payload size">
            ↑ {formatBytes(request.sentBytes)}
            <span className={styles.bytesSeparator} aria-hidden="true">
              ·
            </span>
            ↓ {formatBytes(request.receivedBytes)}
          </span>
        ) : (
          <span className={styles.requestPendingLabel}>
            {status === 'processing' ? 'processing input…' : 'streaming…'}
          </span>
        )}
        {status === 'done' ? (
          <span className={styles.requestDone} aria-hidden="true">
            ✓
          </span>
        ) : status === 'future' ? null : (
          <Loader className={styles.requestSpinner} size="xs" type="dots" />
        )}
      </span>
      {settled && (
        <span className={styles.requestUsage}>
          <span className={styles.usageItem} title="Cached input tokens">
            <span className={styles.usageLetter}>C</span>
            {formatTokens(usage.cacheRead)}
          </span>
          <span className={styles.usageItem} title="Uncached input tokens">
            <span className={styles.usageLetter}>I</span>
            {formatTokens(usage.input)}
          </span>
          <span className={styles.usageItem} title="Output tokens">
            <span className={styles.usageLetter}>O</span>
            {formatTokens(usage.output)}
          </span>
          <span className={styles.requestCost} title="Cost of this request">
            {formatCost(usage.cost?.total ?? 0)}
          </span>
        </span>
      )}
    </button>
  );
});

const FOOTER_CATEGORY_ROWS: Array<[string, keyof UsageBreakdown]> = [
  ['Cached', 'cached'],
  ['Cache write', 'cacheWrite'],
  ['Input', 'input'],
  ['Output', 'output'],
];

type RequestListProps = {
  states: readonly RequestState[];
  breakdown: UsageBreakdown;
  totalRequests: number;
  futureMode: FutureRequestsMode;
  onFutureModeChange: (mode: FutureRequestsMode) => void;
  onRequestClick: (request: RequestTimeline) => void;
};

export function RequestList({
  states,
  breakdown,
  totalRequests,
  futureMode,
  onFutureModeChange,
  onRequestClick,
}: RequestListProps) {
  // The watch value identifies the newest request sent at the current
  // playback time (id + status): it changes only when the edge advances to
  // another request or the edge card settles (its usage row appears) — not
  // on every playback frame, and not when toggling future-request
  // visibility. In the default hidden mode the list follows it
  // pin-to-bottom; with future requests visible (peek or shown) `follow` is
  // off, the list is a static browsing view, and the jump button is hidden
  // along with the auto-scroll.
  let liveEdgeIndex = -1;
  for (let i = states.length - 1; i >= 0; i -= 1) {
    if (states[i].status !== 'future') {
      liveEdgeIndex = i;
      break;
    }
  }
  const liveEdge = liveEdgeIndex >= 0 ? states[liveEdgeIndex] : undefined;
  const following = futureMode === 'hidden';
  const { containerRef, pinned, pin } = usePinnedAutoScroll(
    liveEdge ? `${liveEdge.request.id}:${liveEdge.status}` : '',
    { follow: following },
  );
  // While future requests are visible, in-flight requests use the settled
  // presentation (see RequestCard); otherwise they show the live labels.
  const settledPending = futureMode !== 'hidden';
  const footerRows = FOOTER_CATEGORY_ROWS.map(([label, category]) => ({
    label,
    category: breakdown[category],
  })).filter(({ category }) => category.tokens > 0 || category.cost > 0);
  return (
    <aside className={styles.requestList} aria-label="Provider requests">
      <header className={styles.listHeader}>
        <div className={styles.listHeaderRow}>
          <Text className={styles.listTitle} size="sm" fw={650}>
            Provider requests
          </Text>
          <Text size="xs" c="dimmed">
            {states.filter(({ status }) => status !== 'future').length} /
            {totalRequests} sent
          </Text>
        </div>
        <div className={styles.listHeaderRow}>
          <Checkbox
            size="xs"
            color={futureMode === 'peek' ? 'gray' : 'violet'}
            label="Show all requests"
            checked={futureMode === 'shown'}
            indeterminate={futureMode === 'peek'}
            onChange={(event) =>
              // From the indeterminate peek state, clicking clears the mode
              // rather than turning it into a permanent one.
              onFutureModeChange(
                futureMode !== 'peek' && event.currentTarget.checked
                  ? 'shown'
                  : 'hidden',
              )
            }
          />
        </div>
      </header>
      <div className={styles.scrollArea}>
        <div className={styles.scroll} ref={containerRef}>
          <div className={styles.cards}>
            {states.map((state) => (
              <RequestCard
                key={state.request.id}
                request={state.request}
                status={state.status}
                settledPending={settledPending}
                onRequestClick={onRequestClick}
              />
            ))}
          </div>
        </div>
        {following && !pinned && (
          <button type="button" className={styles.jumpToLatest} onClick={pin}>
            ↓ Jump to latest
          </button>
        )}
      </div>
      <footer className={styles.listFooter}>
        {footerRows.map(({ label, category }) => (
          <div className={styles.footerRow} key={label}>
            <span className={styles.footerLabel}>{label}</span>
            <span
              className={styles.footerRate}
              title="Implied price per million tokens, from accumulated usage"
            >
              {formatPricePerMillion(category.cost, category.tokens)}
            </span>
            <span className={styles.footerTokens}>
              {formatTokens(category.tokens)}
            </span>
            <span className={styles.footerCost}>
              {formatCost(category.cost)}
            </span>
          </div>
        ))}
        <div className={`${styles.footerRow} ${styles.footerTotalRow}`}>
          <span className={styles.footerLabel}>Total</span>
          {/* No per-million rate: a blended rate across categories is meaningless. */}
          <span />
          <span className={styles.footerTokens}>
            {formatTokens(breakdown.total.tokens)}
          </span>
          <span className={styles.footerCost}>
            {formatCost(breakdown.total.cost)}
          </span>
        </div>
      </footer>
    </aside>
  );
}
