import { Loader } from '@mantine/core';
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

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

/** Quick animated scroll used when the terminal follows a pane open/close. */
const FOCUS_SCROLL_MS = 300;
/** Where the scroll anchor's bottom lands, as a fraction of the viewport. */
const FOCUS_ANCHOR_RATIO = 0.7;
/**
 * Target length of the input boundary band, as a fraction of the terminal
 * height. The band is never shorter than the group it marks and never
 * extends above the transcript's top.
 */
const BOUNDARY_BAND_RATIO = 0.5;

/** How far the highlight band floats outside the group's vertical extent. */
const HIGHLIGHT_PAD_Y = 3;

/**
 * Vertical extent of the pane-focus band. The horizontal span is a fixed
 * lane inset from the terminal edges (see `.highlightBoundary` and
 * `.highlightGroup`), so the band reads as a group boundary rather than a
 * border around individual messages.
 */
type HighlightRect = { top: number; height: number };

function sameHighlightRects(a: HighlightRect[], b: HighlightRect[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (rect, index) =>
        Math.abs(rect.top - b[index].top) < 0.5 &&
        Math.abs(rect.height - b[index].height) < 0.5,
    )
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Animates the container's `scrollTop` to `target` with a quick ease-out,
 * calling `onDone` when the target is reached (not on cancel). Returns a
 * cancel function; sets instantly when the distance is negligible or the
 * user prefers reduced motion.
 */
function animateScrollTop(
  container: HTMLElement,
  target: number,
  onDone?: () => void,
): () => void {
  const start = container.scrollTop;
  if (Math.abs(target - start) < 1 || prefersReducedMotion()) {
    container.scrollTop = target;
    onDone?.();
    return () => {};
  }
  const startedAt = performance.now();
  let frame = 0;
  const step = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / FOCUS_SCROLL_MS);
    const eased = 1 - (1 - progress) ** 3;
    container.scrollTop = start + (target - start) * eased;
    if (progress < 1) frame = requestAnimationFrame(step);
    else onDone?.();
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

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
    <div className={styles.userEntry} data-entry-id={entry.id}>
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
    <div className={styles.thinkingEntry} data-entry-id={entry.id}>
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
    <p className={styles.assistantText} data-entry-id={entry.id}>
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
    <div
      className={styles.toolEntry}
      data-error={resultError || undefined}
      data-entry-id={entry.id}
    >
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
      data-entry-id={entry.id}
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
  /**
   * Id of the request whose pane is open, or `null`. Opening scrolls the
   * transcript so the request's input boundary sits at the focus line;
   * clearing reverts the view (see `revertOnClose`).
   */
  focusRequestId: string | null;
  /**
   * Whether clearing `focusRequestId` scrolls the terminal back to where
   * it was before the jump. `false` when the pane closed via its Go to
   * button: the seek decides where the terminal ends up.
   */
  revertOnClose: boolean;
  /** Ids of the transcript entries outlined while the pane is open. */
  highlightedEntryIds: readonly string[];
  /**
   * Entry whose bottom marks the request's input boundary; opening the
   * pane scrolls it to the focus line. `null` when nothing is visible
   * yet (future requests), in which case the view stays put.
   */
  scrollAnchorEntryId: string | null;
  /**
   * Visual treatment of the highlight band: `boundary` marks where the
   * request's input ends (rails fading toward the top, extended upward);
   * `group` draws a closed box around the response entries.
   */
  highlightVariant: 'boundary' | 'group';
};

export function AgentTerminal({
  timeline,
  states,
  focusRequestId,
  revertOnClose,
  highlightedEntryIds,
  scrollAnchorEntryId,
  highlightVariant,
}: AgentTerminalProps) {
  const { containerRef, pinned, pin, unpin } = usePinnedAutoScroll(states);
  // Cancel function of the running focus animation, if any.
  const cancelScrollRef = useRef<(() => void) | null>(null);
  // View saved when the terminal jumped away for the pane; restored when
  // the pane closes (unless the close followed a seek).
  const savedViewRef = useRef<{ top: number; pinned: boolean } | null>(null);
  const prevFocusRef = useRef<string | null>(null);
  const highlightedIds = useMemo(
    () => new Set(highlightedEntryIds),
    [highlightedEntryIds],
  );
  // Geometry of the pane-focus highlight, measured against the content
  // wrapper so the overlay boxes float over the transcript without touching
  // entry layout.
  const contentRef = useRef<HTMLDivElement>(null);
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || highlightedIds.size === 0) {
      setHighlightRects((previous) => (previous.length === 0 ? previous : []));
      return;
    }
    const measure = () => {
      const container = containerRef.current;
      const contentRect = content.getBoundingClientRect();
      // The band spans the whole highlighted group — from the first entry's
      // top to the last entry's bottom — as one boundary, regardless of how
      // many entries it contains.
      let top = Number.POSITIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;
      for (const id of highlightedIds) {
        const element = content.querySelector<HTMLElement>(
          `[data-entry-id="${CSS.escape(id)}"]`,
        );
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        top = Math.min(top, rect.top - contentRect.top);
        bottom = Math.max(bottom, rect.bottom - contentRect.top);
      }
      if (!Number.isFinite(top)) {
        setHighlightRects((previous) =>
          previous.length === 0 ? previous : [],
        );
        return;
      }
      const bandBottom = bottom + HIGHLIGHT_PAD_Y;
      let bandTop = top - HIGHLIGHT_PAD_Y;
      if (highlightVariant === 'boundary') {
        // The input boundary extends upward toward half the terminal height
        // — a region marker rather than a box around the last message —
        // never shorter than the group and never above the transcript top.
        if (container) {
          bandTop = Math.min(
            bandTop,
            bandBottom - container.clientHeight * BOUNDARY_BAND_RATIO,
          );
        }
        bandTop = Math.max(0, bandTop);
      }
      const band: HighlightRect[] = [
        { top: bandTop, height: bandBottom - bandTop },
      ];
      setHighlightRects((previous) =>
        sameHighlightRects(previous, band) ? previous : band,
      );
    };
    measure();
    // Streaming growth, folds, and reflows change entry positions without a
    // render of this component; the observer keeps the boxes attached.
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [highlightedIds, states, highlightVariant, containerRef]);

  useEffect(() => {
    if (prevFocusRef.current === focusRequestId) return;
    const firstFocus = prevFocusRef.current === null;
    prevFocusRef.current = focusRequestId;
    const container = containerRef.current;
    if (!container) return;

    if (focusRequestId === null) {
      const saved = savedViewRef.current;
      savedViewRef.current = null;
      if (!revertOnClose) {
        // Closed after a seek (Go to button): the seek position decides
        // the view — jump to its bottom and keep following from there.
        cancelScrollRef.current?.();
        pin();
      } else if (saved) {
        cancelScrollRef.current?.();
        if (saved.pinned) {
          // The live edge may have moved while the pane was open; scroll
          // back to following playback — animated, like the jump out.
          cancelScrollRef.current = animateScrollTop(
            container,
            container.scrollHeight,
            pin,
          );
        } else {
          cancelScrollRef.current = animateScrollTop(container, saved.top);
        }
      }
      return;
    }

    // Pane opened or switched to another request: put the request's input
    // boundary — the bottom of its last input message — at the focus line,
    // so the conversation above and the response below are both in view.
    if (!scrollAnchorEntryId) return;
    const element = container.querySelector<HTMLElement>(
      `[data-entry-id="${CSS.escape(scrollAnchorEntryId)}"]`,
    );
    if (!element) return;
    if (firstFocus) {
      // Baseline is saved for the episode: switching panes keeps the
      // original position so closing reverts past every switch.
      savedViewRef.current = { top: container.scrollTop, pinned };
    }
    cancelScrollRef.current?.();
    // Detach the live-follow pin first, so a playback tick mid-animation
    // cannot fight the scroll (the scroll handler would also detach).
    unpin();
    const targetTop =
      container.scrollTop +
      element.getBoundingClientRect().bottom -
      container.getBoundingClientRect().top -
      container.clientHeight * FOCUS_ANCHOR_RATIO;
    cancelScrollRef.current = animateScrollTop(container, targetTop);
  }, [
    focusRequestId,
    revertOnClose,
    scrollAnchorEntryId,
    pinned,
    pin,
    unpin,
    containerRef,
  ]);

  // Stop a running focus animation when the terminal unmounts.
  useEffect(() => () => cancelScrollRef.current?.(), []);
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
          <span className={styles.headerTitle}>{timeline.model}</span>
          {timeline.cwd && (
            <span className={styles.headerCwd}>{timeline.cwd}</span>
          )}
        </div>
        <div className={styles.content} ref={contentRef}>
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
          {highlightRects.length > 0 && (
            <div className={styles.highlightLayer} aria-hidden="true">
              {highlightRects.map((rect, index) => (
                <div
                  className={
                    highlightVariant === 'boundary'
                      ? styles.highlightBoundary
                      : styles.highlightGroup
                  }
                  key={index}
                  style={{ top: rect.top, height: rect.height }}
                />
              ))}
            </div>
          )}
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
