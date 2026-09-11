import { Loader, Text } from '@mantine/core';
import { memo } from 'react';

import { formatBytes, formatCost, formatTokens } from './format.ts';
import {
  type RequestState,
  type RequestTimeline,
  type UsageBreakdown,
} from './timeline.ts';
import { usePinnedAutoScroll } from './use-pinned-scroll.ts';
import styles from './RequestList.module.css';

type RequestCardProps = {
  request: RequestTimeline;
  status: RequestState['status'];
  onRequestClick: (request: RequestTimeline) => void;
};

const RequestCard = memo(function RequestCard({
  request,
  status,
  onRequestClick,
}: RequestCardProps) {
  const usage = request.usage;
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
        {status === 'done' ? (
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
        {status !== 'done' ? (
          <Loader className={styles.requestSpinner} size="xs" type="dots" />
        ) : (
          <span className={styles.requestDone} aria-hidden="true">
            ✓
          </span>
        )}
      </span>
      {status === 'done' && (
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
  onRequestClick: (request: RequestTimeline) => void;
};

export function RequestList({
  states,
  breakdown,
  totalRequests,
  onRequestClick,
}: RequestListProps) {
  const { containerRef, pinned, pin } = usePinnedAutoScroll(states);
  const footerRows = FOOTER_CATEGORY_ROWS.map(([label, category]) => ({
    label,
    category: breakdown[category],
  })).filter(({ category }) => category.tokens > 0 || category.cost > 0);
  return (
    <aside className={styles.requestList} aria-label="Provider requests">
      <header className={styles.listHeader}>
        <Text className={styles.listTitle} size="sm" fw={650}>
          Provider requests
        </Text>
        <Text size="xs" c="dimmed">
          {states.length} / {totalRequests} sent
        </Text>
      </header>
      <div className={styles.scroll} ref={containerRef}>
        <div className={styles.cards}>
          {states.map((state) => (
            <RequestCard
              key={state.request.id}
              request={state.request}
              status={state.status}
              onRequestClick={onRequestClick}
            />
          ))}
        </div>
      </div>
      {!pinned && (
        <button type="button" className={styles.jumpToLatest} onClick={pin}>
          ↓ Jump to latest
        </button>
      )}
      <footer className={styles.listFooter}>
        {footerRows.map(({ label, category }) => (
          <div className={styles.footerRow} key={label}>
            <span className={styles.footerLabel}>{label}</span>
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
