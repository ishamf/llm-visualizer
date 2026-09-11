import { Loader } from '@mantine/core';
import { memo, useMemo, useState } from 'react';

import type { EntryState, Timeline, TimelineEntry } from './timeline.ts';
import { usePinnedAutoScroll } from './use-pinned-scroll.ts';
import styles from './AgentTerminal.module.css';

type TerminalEntryProps = {
  entry: TimelineEntry;
  revealed: number;
  streaming: boolean;
  resultError: boolean | undefined;
};

function Caret() {
  return <span className={styles.caret} aria-hidden="true" />;
}

function UserEntry({
  entry,
}: {
  entry: Extract<TimelineEntry, { kind: 'user' }>;
}) {
  return (
    <div className={styles.userEntry}>
      <span className={styles.userMark} aria-hidden="true">
        ❯
      </span>
      <p className={styles.userText}>{entry.text}</p>
    </div>
  );
}

function ThinkingEntry({
  entry,
  revealed,
  streaming,
}: {
  entry: Extract<TimelineEntry, { kind: 'thinking' }>;
  revealed: number;
  streaming: boolean;
}) {
  // Expanded by default while streaming, collapsed once complete; an explicit
  // user toggle wins over the default.
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(
    null,
  );
  const expanded = expandedOverride ?? streaming;
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
  resultError,
}: TerminalEntryProps) {
  switch (entry.kind) {
    case 'user':
      return <UserEntry entry={entry} />;
    case 'thinking':
      return (
        <ThinkingEntry
          entry={entry}
          revealed={revealed}
          streaming={streaming}
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
