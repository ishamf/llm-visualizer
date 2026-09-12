import { Loader } from '@mantine/core';
import { memo, useMemo, useState } from 'react';

import type { EntryState, Timeline, TimelineEntry } from './timeline.ts';
import { usePinnedAutoScroll } from './use-pinned-scroll.ts';
import styles from './AgentTerminal.module.css';

type TerminalEntryProps = {
  entry: TimelineEntry;
  revealed: number;
  streaming: boolean;
  /** Thinking entries only: auto-collapsed by a later streaming block. */
  autoCollapsed: boolean;
  resultError: boolean | undefined;
};

function Caret() {
  return <span className={styles.caret} aria-hidden="true" />;
}

/** Adds `ids` to `set`; returns `set` itself when nothing is added. */
function addAllIds(
  set: ReadonlySet<string>,
  ids: ReadonlySet<string>,
): ReadonlySet<string> {
  let changed = false;
  const next = new Set(set);
  for (const id of ids) {
    if (!next.has(id)) {
      next.add(id);
      changed = true;
    }
  }
  return changed ? next : set;
}

/** Ids of thinking entries a later streaming thinking block supersedes. */
function supersededThinkingIds(
  states: readonly EntryState[],
): ReadonlySet<string> {
  // Entries arrive in transcript order, so everything before the last
  // streaming thinking entry is superseded right now.
  let lastStreamingIndex = -1;
  states.forEach(({ entry, streaming }, index) => {
    if (entry.kind === 'thinking' && streaming) lastStreamingIndex = index;
  });
  const ids = new Set<string>();
  if (lastStreamingIndex < 0) return ids;
  states.forEach(({ entry }, index) => {
    if (index < lastStreamingIndex && entry.kind === 'thinking') {
      ids.add(entry.id);
    }
  });
  return ids;
}

/**
 * Auto-collapse ledger for thinking blocks. `collapsed` is sticky: a block
 * folds when a later thinking block streams and stays folded. Collapses are
 * deferred while the user is scrolled away — `deferred` tracks the blocks
 * that would have folded, and they fold once the user is back on the latest.
 */
type CollapseLedger = {
  collapsed: ReadonlySet<string>;
  deferred: ReadonlySet<string>;
  /** Snapshot the ledger last absorbed. */
  states: readonly EntryState[];
  pinned: boolean;
};

/** Applies pending collapse events to the ledger; pure and idempotent. */
function absorbCollapseEvents(
  ledger: CollapseLedger,
  states: readonly EntryState[],
  pinned: boolean,
): CollapseLedger {
  const superseded = supersededThinkingIds(states);
  let collapsed = ledger.collapsed;
  let deferred = ledger.deferred;
  if (pinned) {
    collapsed = addAllIds(collapsed, superseded);
    if (!ledger.pinned && deferred.size > 0) {
      // Back on the latest: fold in everything deferred while scrolled away.
      collapsed = addAllIds(collapsed, deferred);
      deferred = new Set<string>();
    }
  } else {
    deferred = addAllIds(deferred, superseded);
  }
  if (
    collapsed === ledger.collapsed &&
    deferred === ledger.deferred &&
    states === ledger.states &&
    pinned === ledger.pinned
  ) {
    return ledger;
  }
  return { collapsed, deferred, states, pinned };
}

function UserEntry({
  entry,
  revealed,
  streaming,
}: {
  entry: Extract<TimelineEntry, { kind: 'user' }>;
  revealed: number;
  streaming: boolean;
}) {
  return (
    <div className={styles.userEntry}>
      <span className={styles.userMark} aria-hidden="true">
        ❯
      </span>
      <p className={styles.userText}>
        {entry.text.slice(0, revealed)}
        {streaming && <Caret />}
      </p>
    </div>
  );
}

function ThinkingEntry({
  entry,
  revealed,
  streaming,
  autoCollapsed,
}: {
  entry: Extract<TimelineEntry, { kind: 'thinking' }>;
  revealed: number;
  streaming: boolean;
  autoCollapsed: boolean;
}) {
  // Expanded by default: while streaming, and it stays expanded once
  // complete. Auto-collapse happens when a later thinking block starts
  // streaming — immediately while pinned to the bottom, deferred while the
  // user is scrolled away (`autoCollapsed`). An explicit user toggle wins
  // over the default.
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(
    null,
  );
  const expanded = expandedOverride ?? (streaming || !autoCollapsed);
  return (
    <div className={styles.thinkingEntry}>
      <button
        type="button"
        className={styles.thinkingToggle}
        onClick={() =>
          setExpandedOverride((value) => (value ?? expanded) === false)
        }
        aria-expanded={expanded}
      >
        <span className={styles.thinkingGlyph} aria-hidden="true">
          ✻
        </span>
        {streaming ? 'Thinking' : 'Thought process'}
        <span className={styles.chevron} aria-hidden="true">
          {expanded ? '⌄' : '›'}
        </span>
      </button>
      {expanded && (
        <p className={styles.thinkingText}>
          {entry.text.slice(0, revealed)}
          {streaming && <Caret />}
        </p>
      )}
    </div>
  );
}

function TextEntry({
  entry,
  revealed,
  streaming,
}: {
  entry: Extract<TimelineEntry, { kind: 'text' }>;
  revealed: number;
  streaming: boolean;
}) {
  return (
    <p className={styles.assistantText}>
      {entry.text.slice(0, revealed)}
      {streaming && <Caret />}
    </p>
  );
}

function ToolCallEntry({
  entry,
  streaming,
  resultError,
}: {
  entry: Extract<TimelineEntry, { kind: 'toolCall' }>;
  streaming: boolean;
  resultError: boolean | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  // The call keeps "running" until its result appears — covering both the
  // streamed arguments and the tool execution phase after the response ends.
  const running = streaming || resultError === undefined;
  return (
    <div className={styles.toolEntry} data-error={resultError || undefined}>
      <button
        type="button"
        className={styles.toolHeader}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        {running ? (
          <Loader className={styles.toolSpinner} size="xs" type="dots" />
        ) : (
          <span className={styles.toolStatus} aria-hidden="true">
            {resultError ? '✕' : '✓'}
          </span>
        )}
        <span className={styles.toolName}>{entry.name}</span>
        <span className={styles.toolSummary}>{entry.summary}</span>
        <span className={styles.chevron} aria-hidden="true">
          {expanded ? '⌄' : '›'}
        </span>
      </button>
      {expanded && <pre className={styles.toolArgs}>{entry.argsText}</pre>}
    </div>
  );
}

function previewLines(text: string, lineCount: number): string {
  const lines = text.split('\n');
  const preview = lines.slice(0, lineCount).join('\n');
  return lines.length > lineCount ? `${preview}\n…` : preview;
}

function ToolResultEntry({
  entry,
}: {
  entry: Extract<TimelineEntry, { kind: 'toolResult' }>;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={styles.toolResultEntry}
      data-error={entry.isError || undefined}
    >
      <button
        type="button"
        className={styles.toolResultToggle}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className={styles.chevron} aria-hidden="true">
          {expanded ? '⌄' : '›'}
        </span>
        {entry.toolName} output{entry.isError ? ' · error' : ''}
      </button>
      <pre
        className={expanded ? styles.toolResultFull : styles.toolResultPreview}
      >
        {expanded ? entry.text : previewLines(entry.text, 3)}
      </pre>
    </div>
  );
}

const TerminalEntry = memo(function TerminalEntry({
  entry,
  revealed,
  streaming,
  autoCollapsed,
  resultError,
}: TerminalEntryProps) {
  switch (entry.kind) {
    case 'user':
      return (
        <UserEntry entry={entry} revealed={revealed} streaming={streaming} />
      );
    case 'thinking':
      return (
        <ThinkingEntry
          entry={entry}
          revealed={revealed}
          streaming={streaming}
          autoCollapsed={autoCollapsed}
        />
      );
    case 'text':
      return (
        <TextEntry entry={entry} revealed={revealed} streaming={streaming} />
      );
    case 'toolCall':
      return (
        <ToolCallEntry
          entry={entry}
          streaming={streaming}
          resultError={resultError}
        />
      );
    case 'toolResult':
      return <ToolResultEntry entry={entry} />;
  }
});

type AgentTerminalProps = {
  timeline: Timeline;
  states: readonly EntryState[];
};

export function AgentTerminal({ timeline, states }: AgentTerminalProps) {
  const { containerRef, pinned, pin } = usePinnedAutoScroll(states);
  const resultErrorByCallId = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const { entry } of states) {
      if (entry.kind === 'toolResult') map.set(entry.callId, entry.isError);
    }
    return map;
  }, [states]);
  // Auto-collapse ledger, adjusted during render whenever the snapshot or
  // pin state changes — the React-documented alternative to syncing state in
  // an effect. While the user is scrolled away, collapses are deferred and
  // tracked in the ledger; they apply once they return to the latest.
  const [ledger, setLedger] = useState<CollapseLedger>(() => ({
    collapsed: new Set<string>(),
    deferred: new Set<string>(),
    states,
    pinned,
  }));
  if (ledger.states !== states || ledger.pinned !== pinned) {
    setLedger((prev) => absorbCollapseEvents(prev, states, pinned));
  }
  const isAutoCollapsed = (entry: TimelineEntry): boolean =>
    entry.kind === 'thinking' && ledger.collapsed.has(entry.id);

  return (
    <div className={styles.terminal}>
      <div className={styles.scroll} ref={containerRef}>
        <div className={styles.header}>
          <span className={styles.headerTitle}>
            {timeline.provider} · {timeline.model}
          </span>
          {timeline.cwd && (
            <span className={styles.headerCwd}>{timeline.cwd}</span>
          )}
        </div>
        <div className={styles.transcript}>
          {states.map(({ entry, revealed, streaming }) => (
            <TerminalEntry
              key={entry.id}
              entry={entry}
              revealed={revealed}
              streaming={streaming}
              autoCollapsed={isAutoCollapsed(entry)}
              resultError={
                entry.kind === 'toolCall'
                  ? resultErrorByCallId.get(entry.callId)
                  : undefined
              }
            />
          ))}
        </div>
      </div>
      {!pinned && (
        <button type="button" className={styles.jumpToLatest} onClick={pin}>
          ↓ Jump to latest
        </button>
      )}
    </div>
  );
}
