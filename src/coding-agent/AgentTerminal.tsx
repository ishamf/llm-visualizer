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

/**
 * Ids of thinking entries already superseded at this playback position —
 * every thinking entry in the snapshot except the most recent one. A block
 * folds when the next one starts streaming and stays folded, so this is
 * exactly the collapse state continuous playback would have produced.
 */
function supersededThinkingIds(
  states: readonly EntryState[],
): ReadonlySet<string> {
  // Entries arrive in transcript order, so the last thinking entry in the
  // snapshot is the most recent one.
  let lastThinkingIndex = -1;
  states.forEach(({ entry }, index) => {
    if (entry.kind === 'thinking') lastThinkingIndex = index;
  });
  const ids = new Set<string>();
  states.forEach(({ entry }, index) => {
    if (index < lastThinkingIndex && entry.kind === 'thinking') {
      ids.add(entry.id);
    }
  });
  return ids;
}

/**
 * Collapse state frozen while the user is scrolled away. While pinned, the
 * collapse state follows the current snapshot directly; the freeze keeps the
 * blocks the user is reading expanded, and is discarded when they return to
 * the latest.
 */
type AwayCollapse = {
  collapsed: ReadonlySet<string>;
  /** True while the user is scrolled away and `collapsed` is authoritative. */
  frozen: boolean;
};

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
  // While pinned, thinking blocks fold exactly as continuous playback would
  // have folded them — everything but the most recent. Scrolling away freezes
  // that state: blocks the user is reading stay expanded, and the fold catches
  // up (including anything missed while away) when they return to the latest.
  // Seeking runs through the same derivation, so scrubbing replays the same
  // fold pattern.
  const [away, setAway] = useState<AwayCollapse>(() => ({
    collapsed: supersededThinkingIds(states),
    frozen: !pinned,
  }));
  const currentSuperseded = supersededThinkingIds(states);
  if (away.frozen !== !pinned) {
    setAway({ collapsed: currentSuperseded, frozen: !pinned });
  }
  const isAutoCollapsed = (entry: TimelineEntry): boolean =>
    entry.kind === 'thinking' &&
    (away.frozen
      ? away.collapsed.has(entry.id)
      : currentSuperseded.has(entry.id));

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
