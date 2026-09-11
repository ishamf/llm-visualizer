import { Loader, Text } from '@mantine/core';
import { memo } from 'react';

import { formatCost, formatTokens } from './format.ts';
import type { RequestState } from './timeline.ts';
import { usePinnedAutoScroll } from './use-pinned-scroll.ts';
import styles from './RequestList.module.css';

type RequestCardProps = {
  state: RequestState;
};

const RequestCard = memo(function RequestCard({ state }: RequestCardProps) {
  const { request, status } = state;
  const usage = request.usage;
  return (
    <div className={styles.requestCard} data-status={status}>
      <div className={styles.requestHeader}>
        <span className={styles.requestIndex}>#{request.index}</span>
        <span className={styles.requestModel}>{request.model}</span>
        {status === 'streaming' ? (
          <Loader className={styles.requestSpinner} size="xs" type="dots" />
        ) : (
          <span className={styles.requestDone} aria-hidden="true">
            ✓
          </span>
        )}
      </div>
      {status === 'done' ? (
        <div className={styles.requestUsage}>
          <span className={styles.usageItem} title="Input tokens">
            ↑ {formatTokens(usage.input)}
          </span>
          <span className={styles.usageItem} title="Output tokens">
            ↓ {formatTokens(usage.output)}
          </span>
          {usage.cacheRead > 0 && (
            <span className={styles.usageItem} title="Cache read tokens">
              ⚡ {formatTokens(usage.cacheRead)}
            </span>
          )}
          <span className={styles.requestCost}>
            {formatCost(usage.cost?.total ?? 0)}
          </span>
        </div>
      ) : (
        <Text className={styles.requestPending} size="xs" c="dimmed">
          streaming…
        </Text>
      )}
    </div>
  );
});

type RequestListProps = {
  states: readonly RequestState[];
  totals: { input: number; output: number; cost: number };
  totalRequests: number;
};

export function RequestList({
  states,
  totals,
  totalRequests,
}: RequestListProps) {
  const { containerRef, pinned, pin } = usePinnedAutoScroll(states);
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
            <RequestCard key={state.request.id} state={state} />
          ))}
        </div>
      </div>
      {!pinned && (
        <button type="button" className={styles.jumpToLatest} onClick={pin}>
          ↓ Jump to latest
        </button>
      )}
      <footer className={styles.listFooter}>
        <span className={styles.totalItem} title="Input tokens so far">
          ↑ {formatTokens(totals.input)}
        </span>
        <span className={styles.totalItem} title="Output tokens so far">
          ↓ {formatTokens(totals.output)}
        </span>
        <span className={styles.totalCost} title="Cost so far">
          {formatCost(totals.cost)}
        </span>
      </footer>
    </aside>
  );
}
