import { useState } from 'react';

import { formatCost, formatTokens } from './format.ts';
import { RequestList, type FutureRequestsMode } from './RequestList.tsx';
import { RequestPane, type ExpandedSection } from './RequestPane.tsx';
import type { PackedSession } from './packed-session.ts';
import type {
  RequestState,
  RequestTimeline,
  UsageBreakdown,
} from './timeline.ts';
import styles from './MobileRequestOverlay.module.css';

type MobileRequestOverlayProps = {
  states: readonly RequestState[];
  breakdown: UsageBreakdown;
  totalRequests: number;
  futureMode: FutureRequestsMode;
  onFutureModeChange: (mode: FutureRequestsMode) => void;
  /** Opens (or toggles) the request pane; pauses playback like on desktop. */
  onRequestTogglePane: (request: RequestTimeline) => void;
  /** Id of the request shown in the request pane, if any. */
  selectedRequestId: string | null;
  paneRequest: RequestTimeline | null;
  session: PackedSession;
  /** Which pane accordion section is expanded; owned by the page. */
  expanded: ExpandedSection;
  onExpand: (section: ExpandedSection) => void;
  onGoto: (request: RequestTimeline) => void;
  onClosePane: () => void;
};

/**
 * Mobile alternate UI for the provider requests. The terminal stands alone;
 * a floating summary card (requests made plus accumulated tokens and cost)
 * sits in its top-right corner and opens the request list as a drawer that
 * slides in from the right over a dimmed backdrop. Opening a request's pane
 * slides a slightly narrower drawer on top — the list's left edge stays
 * visible in the gap and clicking it (or the backdrop) returns to the list.
 *
 * Playback state and the pane are owned by the page; this component only
 * owns whether the list drawer is open, so pause/resume-on-close semantics
 * match the desktop UI exactly.
 */
export function MobileRequestOverlay({
  states,
  breakdown,
  totalRequests,
  futureMode,
  onFutureModeChange,
  onRequestTogglePane,
  selectedRequestId,
  paneRequest,
  session,
  expanded,
  onExpand,
  onGoto,
  onClosePane,
}: MobileRequestOverlayProps) {
  const [listOpen, setListOpen] = useState(false);
  // The pane always opens from the list, and closing it returns there, so
  // the list drawer stays open underneath for as long as the pane is open —
  // including when the pane survives a resize from the desktop layout.
  const paneOpen = paneRequest !== null;
  const drawerOpen = listOpen || paneOpen;
  const sentCount = states.filter(({ status }) => status !== 'future').length;

  return (
    <div className={styles.overlay}>
      <button
        type="button"
        className={styles.summaryCard}
        onClick={() => setListOpen(true)}
        aria-expanded={drawerOpen}
        aria-controls="mobile-request-list"
      >
        <span className={styles.summaryRequests}>
          {sentCount} requests made
        </span>
        <span className={styles.summaryUsage}>
          {formatTokens(breakdown.total.tokens)} tokens ·{' '}
          {formatCost(breakdown.total.cost)}
        </span>
      </button>

      {drawerOpen && !paneOpen && (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="Close requests list"
          tabIndex={-1}
          onClick={() => setListOpen(false)}
        />
      )}

      <div
        id="mobile-request-list"
        className={styles.listDrawer}
        data-open={drawerOpen || undefined}
      >
        <RequestList
          className={styles.listFill}
          states={states}
          breakdown={breakdown}
          totalRequests={totalRequests}
          futureMode={futureMode}
          onFutureModeChange={onFutureModeChange}
          onRequestClick={onRequestTogglePane}
          selectedRequestId={selectedRequestId}
        />
      </div>

      {paneOpen && (
        <>
          <button
            type="button"
            className={`${styles.backdrop} ${styles.paneBackdrop}`}
            aria-label="Close request details"
            tabIndex={-1}
            onClick={onClosePane}
          />
          <div className={styles.paneDrawer}>
            <RequestPane
              key={paneRequest.id}
              request={paneRequest}
              session={session}
              expanded={expanded}
              onExpand={onExpand}
              onGoto={onGoto}
              onClose={onClosePane}
            />
          </div>
        </>
      )}
    </div>
  );
}
