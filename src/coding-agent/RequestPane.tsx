import { useMemo, useState, type ReactNode } from 'react';

import { formatBytes, formatClock } from './format.ts';
import type { PackedSession, PackedResponse } from './packed-session.ts';
import type { RequestTimeline } from './timeline.ts';
import styles from './RequestPane.module.css';

/**
 * Which accordion section is expanded. Exactly one section is expanded at
 * all times: opening the other collapses the current one, and an open
 * section cannot be collapsed.
 */
type ExpandedSection = 'input' | 'output';

/**
 * The pane's raw content for a request: the prompt prefix that was sent as
 * pretty-printed JSON (the same shape the payload byte sizes were computed
 * from) and the parsed assistant response, if one was recorded.
 */
function requestPayload(
  session: PackedSession,
  request: RequestTimeline,
): { input: string; response: PackedResponse | undefined } {
  const packed = session.requests[request.index - 1];
  return {
    input: JSON.stringify(
      {
        system: session.prompt.system,
        tools: session.prompt.tools,
        messages: session.prompt.messages.slice(0, packed?.messageCount ?? 0),
      },
      null,
      2,
    ),
    response: packed?.response,
  };
}

type CodeSectionProps = {
  label: string;
  bytes: number;
  expanded: boolean;
  onExpand: () => void;
  children: ReactNode;
};

function CodeSection({
  label,
  bytes,
  expanded,
  onExpand,
  children,
}: CodeSectionProps) {
  return (
    <section className={styles.section} data-expanded={expanded || undefined}>
      <button
        type="button"
        className={styles.sectionToggle}
        onClick={onExpand}
        aria-expanded={expanded}
      >
        <span className={styles.chevron} aria-hidden="true">
          {expanded ? '⌄' : '›'}
        </span>
        <span className={styles.sectionLabel}>{label}</span>
        <span className={styles.sectionBytes} title="UTF-8 JSON payload size">
          {formatBytes(bytes)}
        </span>
      </button>
      {expanded && children}
    </section>
  );
}

type RequestPaneProps = {
  request: RequestTimeline;
  /** Packed session the request belongs to; provides the payload content. */
  session: PackedSession;
  /** Jumps the playback to when this request's response finished. */
  onGoto: (request: RequestTimeline) => void;
  onClose: () => void;
};

/**
 * Detail view for a single provider request, shown next to the request list
 * (which slides left to make room). The header's Go to button jumps the
 * playback to when the request completed and closes the pane. The space is
 * reserved for the input/output accordion: the request input (the prompt
 * prefix that was sent) and the parsed response as scrollable JSON code
 * boxes. The input starts expanded and exactly one section is always
 * expanded.
 */
export function RequestPane({
  request,
  session,
  onGoto,
  onClose,
}: RequestPaneProps) {
  const [expanded, setExpanded] = useState<ExpandedSection>('input');
  const payload = useMemo(
    () => requestPayload(session, request),
    [session, request],
  );
  return (
    <aside
      className={styles.pane}
      aria-label={`Details of request ${request.index}`}
    >
      <header className={styles.paneHeader}>
        <span className={styles.paneTitle}>Request #{request.index}</span>
        <button
          type="button"
          className={styles.paneGoto}
          title="Pause and seek to when this request completed"
          onClick={() => onGoto(request)}
        >
          Go to {formatClock(request.endTime)}
        </button>
        <button
          type="button"
          className={styles.paneClose}
          onClick={onClose}
          aria-label="Close request details"
        >
          ×
        </button>
      </header>
      <div className={styles.sections}>
        <CodeSection
          label="Input"
          bytes={request.sentBytes}
          expanded={expanded === 'input'}
          onExpand={() => setExpanded('input')}
        >
          <pre className={styles.code}>{payload.input}</pre>
        </CodeSection>
        <CodeSection
          label="Output"
          bytes={request.receivedBytes}
          expanded={expanded === 'output'}
          onExpand={() => setExpanded('output')}
        >
          {payload.response ? (
            <pre className={styles.code}>
              {JSON.stringify(payload.response, null, 2)}
            </pre>
          ) : (
            <p className={styles.noResponse}>
              No response was recorded for this request.
            </p>
          )}
        </CodeSection>
      </div>
    </aside>
  );
}
