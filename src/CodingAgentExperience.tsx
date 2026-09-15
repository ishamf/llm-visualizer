import { Alert, Button, Container, Group, Menu, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { AgentTerminal } from './coding-agent/AgentTerminal.tsx';
import { MobileRequestOverlay } from './coding-agent/MobileRequestOverlay.tsx';
import { formatClock, formatCost } from './coding-agent/format.ts';
import type { PackedSession } from './coding-agent/packed-session.ts';
import { PlaybackBar } from './coding-agent/PlaybackBar.tsx';
import {
  RequestPane,
  type ExpandedSection,
} from './coding-agent/RequestPane.tsx';
import {
  RequestList,
  type FutureRequestsMode,
} from './coding-agent/RequestList.tsx';
import type { SessionIndexEntry } from './coding-agent/session-index.ts';
import { sessionUrl } from './coding-agent/session-urls.ts';
import {
  entriesAt,
  lastInputEntryId,
  playbackDurationSeconds,
  requestsAt,
  usageBreakdownAt,
  type RequestTimeline,
} from './coding-agent/timeline.ts';
import { useAgentSession } from './coding-agent/use-agent-session.ts';
import { usePlayback } from './coding-agent/use-playback.ts';
import { useSessionIndex } from './coding-agent/use-session-index.ts';
import { GENERATED_DATA_BASE_URL } from './data/dataset-catalog.ts';
import pageStyles from './pages/CodingAgentPage.module.css';
import shared from './shared.module.css';
import { usePortalTarget } from './web-component/portal-target-context.ts';

export type CodingAgentExperienceProps = {
  /**
   * Article-level heading and description rendered at the start of the
   * header, before the session metadata. Standalone pages provide their own;
   * embedded hosts may leave it out and supply copy around the element.
   */
  headerContent?: ReactNode;
  /**
   * Page-only chrome rendered above the header, inside the page container —
   * e.g. the standalone app's back-to-homepage link.
   */
  headerLead?: ReactNode;
  /**
   * Page-only recovery action rendered in the error and empty states — e.g.
   * the standalone app's back-to-homepage button.
   */
  errorAction?: ReactNode;
  /**
   * Page-only content rendered below the playback bar once the session has
   * loaded, receiving the packed session — e.g. the standalone app's
   * cost-over-context chart. Not tied to playback.
   */
  footerContent?: (session: PackedSession) => ReactNode;
  /**
   * Base URL of the generated data; the session index is loaded from
   * `<base>coding-agent/index.json`. Defaults to the build-time
   * `VITE_GENERATED_DATA_BASE_URL` (`/generated/`).
   */
  generatedDataBaseUrl?: string;
  /**
   * Session to replay; `null`/`undefined` (and unknown ids) select the first
   * entry of the session index.
   */
  sessionId?: string | null;
  /**
   * Called when the user picks a session in the header selector, with `null`
   * for the default first session.
   */
  onSessionSelect: (sessionId: string | null) => void;
};

/** Below this width the experience renders the mobile alternate UI. Matches the
 * desktop breakpoint the workbench styles used to collapse at. */
const MOBILE_MEDIA_QUERY = '(max-width: 900px)';

/** Requests after which the mobile floating summary card permanently switches
 * from the compact "N requests made" summary to the desktop request list
 * footer's per-category breakdown. One-way: seeking playback back behind the
 * switch never reverts it. */
const MOBILE_BREAKDOWN_AFTER_REQUESTS = 3;

const EMPTY_BREAKDOWN = {
  cached: { tokens: 0, cost: 0 },
  cacheWrite: { tokens: 0, cost: 0 },
  input: { tokens: 0, cost: 0 },
  output: { tokens: 0, cost: 0 },
  total: { tokens: 0, cost: 0 },
};

function useSpaceToggle(onToggle: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.repeat) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('button, input, textarea, select, [role="slider"]')
      ) {
        return;
      }
      event.preventDefault();
      onToggle();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onToggle, enabled]);
}

function SessionMenuLabel({ session }: { session: SessionIndexEntry }) {
  return (
    <span className={pageStyles.sessionMenuItem}>
      <span className={pageStyles.sessionMenuTitle}>{session.info.title}</span>
      <span className={pageStyles.sessionMenuMeta}>
        {session.model}
        {' · '}
        {session.requestCount} requests
        {' · '}
        {formatClock(session.durationSeconds)}
        {' · '}
        {formatCost(session.totalCost)}
      </span>
    </span>
  );
}

export function CodingAgentExperience({
  errorAction,
  footerContent,
  generatedDataBaseUrl = GENERATED_DATA_BASE_URL,
  headerContent,
  headerLead,
  onSessionSelect,
  sessionId,
}: CodingAgentExperienceProps) {
  const indexState = useSessionIndex(generatedDataBaseUrl);

  if (indexState.status === 'loading') {
    return (
      <Container size="sm" className={shared.pageState}>
        <Text c="dimmed">Loading the coding agent sessions…</Text>
      </Container>
    );
  }

  if (indexState.status === 'error') {
    return (
      <Container size="sm" className={shared.pageState}>
        <Alert color="red" title="Sessions unavailable">
          {indexState.error.message}
        </Alert>
        {errorAction}
      </Container>
    );
  }

  const sessions = indexState.index.sessions;
  if (sessions.length === 0) {
    return (
      <Container size="sm" className={shared.pageState}>
        <Alert color="red" title="Sessions unavailable">
          No coding agent sessions were found in the session index.
        </Alert>
        {errorAction}
      </Container>
    );
  }

  const selected =
    sessions.find((session) => session.id === sessionId) ?? sessions[0];

  const selectSession = (id: string) => {
    onSessionSelect(id === sessions[0].id ? null : id);
  };

  return (
    <SessionReplay
      key={selected.id}
      errorAction={errorAction}
      footerContent={footerContent}
      generatedDataBaseUrl={generatedDataBaseUrl}
      headerContent={headerContent}
      headerLead={headerLead}
      selected={selected}
      sessions={sessions}
      onSelect={selectSession}
    />
  );
}

function SessionReplay({
  errorAction,
  footerContent,
  generatedDataBaseUrl,
  headerContent,
  headerLead,
  selected,
  sessions,
  onSelect,
}: {
  errorAction?: ReactNode;
  footerContent?: (session: PackedSession) => ReactNode;
  generatedDataBaseUrl: string;
  headerContent?: ReactNode;
  headerLead?: ReactNode;
  selected: SessionIndexEntry;
  sessions: readonly SessionIndexEntry[];
  onSelect: (id: string) => void;
}) {
  const session = useAgentSession(sessionUrl(selected, generatedDataBaseUrl));
  const duration =
    session.status === 'ready' ? playbackDurationSeconds(session.timeline) : 0;
  const playback = usePlayback(duration, { autoPlay: true });
  // The individual functions are stable across renders; the hook result
  // object is not, so destructure before using them in callbacks.
  const { time, playing, speed, setSpeed, toggle, play, pause, seek } =
    playback;
  const ready = session.status === 'ready';
  const timeline = ready ? session.timeline : null;
  const packedSession = ready ? session.session : null;
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY);
  const portalTarget = usePortalTarget();

  // Future requests are normally hidden. Jumping to an earlier request (the
  // pane's Go to button) shows them in a temporary "peek" mode (the checkbox
  // renders indeterminate) until the user plays or seeks; the checkbox flips
  // into a permanent "shown" mode. The peek is bounded: only requests up to
  // the edge that was visible before the jump appear, so jumping back never
  // reveals anything new.
  const [futureMode, setFutureMode] = useState<FutureRequestsMode>('hidden');
  const [peekLimit, setPeekLimit] = useState(0);
  // The request pane shows one request's payloads. It is keyed per request,
  // so opening another one resets its accordion.
  const [paneRequest, setPaneRequest] = useState<RequestTimeline | null>(null);
  /**
   * Whether closing the pane should scroll the terminal back to where it
   * was. Cleared by the pane's Go to button, which seeks before closing —
   * the seek position decides where the terminal ends up instead.
   */
  const [paneRevertOnClose, setPaneRevertOnClose] = useState(true);
  /** Which pane accordion section is expanded; reset when the pane opens. */
  const [paneSection, setPaneSection] = useState<ExpandedSection>('input');
  // Whether playback was running when the pane opened, so closing it can
  // resume. Set only on the open transition (switching requests keeps it);
  // manual play/pause while the pane is open cancels it.
  const [resumeOnPaneClose, setResumeOnPaneClose] = useState(false);
  // The mobile request list drawer covers the terminal just like the pane,
  // so it pauses playback the same way. Its open state lives here (the
  // desktop list is a permanent column and has no open state) so opening
  // the drawer can pause; the resume intent works like the pane's.
  const [listOpen, setListOpen] = useState(false);
  const [resumeOnListClose, setResumeOnListClose] = useState(false);

  const entryStates = useMemo(
    () => (timeline ? entriesAt(timeline, time) : []),
    [timeline, time],
  );
  /**
   * Terminal wiring for the open pane: which transcript entries to outline,
   * and which entry anchors the focus scroll. With the input expanded, the
   * request's last input message is outlined; with the output expanded, all
   * of the request's response entries are. The scroll anchor is always the
   * input boundary — the bottom of the last input message.
   */
  const paneHighlight = useMemo(() => {
    if (!paneRequest || !packedSession)
      return { highlightIds: [], anchorId: null };
    const packed = packedSession.requests[paneRequest.index - 1];
    const anchorId = lastInputEntryId(
      packedSession.prompt.messages.slice(0, packed?.messageCount ?? 0),
      entryStates,
    );
    const highlightIds =
      paneSection === 'output'
        ? entryStates
            .filter(
              ({ entry }) =>
                'requestId' in entry && entry.requestId === paneRequest.id,
            )
            .map(({ entry }) => entry.id)
        : anchorId
          ? [anchorId]
          : [];
    return { highlightIds, anchorId };
  }, [paneRequest, paneSection, entryStates, packedSession]);
  const requestStates = useMemo(
    () =>
      timeline
        ? requestsAt(timeline, time, {
            includeFuture: futureMode !== 'hidden',
            futureLimit: futureMode === 'peek' ? peekLimit : undefined,
          })
        : [],
    [timeline, time, futureMode, peekLimit],
  );
  const totals = useMemo(
    () => (timeline ? usageBreakdownAt(timeline, time) : EMPTY_BREAKDOWN),
    [timeline, time],
  );
  // High-water mark of requests sent during this replay. Seeking back lowers
  // the live count but never this mark, so the mobile summary card's switch
  // to the footer-style breakdown (see MOBILE_BREAKDOWN_AFTER_REQUESTS) is
  // permanent. Updated during render — React bails out unless it increases.
  const sentCount = requestStates.reduce(
    (count, { status }) => (status !== 'future' ? count + 1 : count),
    0,
  );
  const [peakSentCount, setPeakSentCount] = useState(0);
  if (sentCount > peakSentCount) setPeakSentCount(sentCount);

  // Index of the newest request sent at the current playback time (0 before
  // the first request). Mirrored into a ref so the stable seek callback can
  // read the edge at click time without depending on per-frame values.
  let liveEdgeIndex = 0;
  for (const { request, status } of requestStates) {
    if (status !== 'future') liveEdgeIndex = request.index;
  }
  const liveEdgeRef = useRef(0);
  useEffect(() => {
    liveEdgeRef.current = liveEdgeIndex;
  }, [liveEdgeIndex]);

  const clearPeek = useCallback(() => {
    setFutureMode((mode) => (mode === 'peek' ? 'hidden' : mode));
    // The bound belongs to the peek episode; drop it so the next jump
    // captures a fresh edge.
    setPeekLimit(0);
  }, []);

  // Manual play/pause while the pane or the mobile request list drawer is
  // open discards the resume-on-close intents: the user has taken over
  // playback.
  const handleToggle = useCallback(() => {
    if (paneRequest) setResumeOnPaneClose(false);
    if (listOpen) setResumeOnListClose(false);
    toggle();
    clearPeek();
  }, [paneRequest, listOpen, toggle, clearPeek]);

  const handleSeek = useCallback(
    (value: number) => {
      seek(value);
      clearPeek();
    },
    [seek, clearPeek],
  );

  useSpaceToggle(handleToggle, ready);

  // Closing the pane (close button, backdrop, or toggling the card) resumes
  // playback when it was running when the pane opened — unless a manual
  // play/pause has cancelled the intent (see handleToggle). `play` no-ops
  // when already playing, and the resume intent only exists while the pane
  // is open and paused, so it cannot restart a finished replay.
  const closePane = useCallback(() => {
    setPaneRequest(null);
    if (resumeOnPaneClose) play();
    setResumeOnPaneClose(false);
  }, [resumeOnPaneClose, play]);

  // Opening the mobile request list covers the terminal, so it pauses
  // playback like the pane does, remembering whether it was running so
  // closing can resume; closing the drawer resumes unless a manual
  // play/pause (see handleToggle) or a Go to jump cancelled the intent. The
  // pane keeps the drawer open underneath it, so the pause belongs to the
  // last drawer that uncovered the terminal.
  const handleListOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        if (!listOpen && !paneRequest) {
          setResumeOnListClose(playing);
          pause();
        }
      } else {
        if (resumeOnListClose) play();
        setResumeOnListClose(false);
      }
      setListOpen(open);
    },
    [listOpen, paneRequest, playing, pause, play, resumeOnListClose],
  );

  // Clicking a card toggles the request pane. Opening it pauses playback,
  // remembering whether it was running so closing can resume; switching
  // requests leaves the pause state untouched.
  const handleRequestTogglePane = useCallback(
    (request: RequestTimeline) => {
      if (paneRequest) {
        if (paneRequest.id === request.id) closePane();
        else {
          setPaneSection('input');
          setPaneRequest(request);
        }
        return;
      }
      setResumeOnPaneClose(playing);
      pause();
      setPaneSection('input');
      setPaneRevertOnClose(true);
      setPaneRequest(request);
    },
    [paneRequest, playing, pause, closePane],
  );

  // The pane's Go to button jumps to when that request's response finished
  // streaming: pause, seek, reveal the already-visible requests (bounded
  // peek), and close the pane. Playback stays paused — the resume-on-close
  // intent is discarded.
  const handleRequestGoto = useCallback(
    (request: RequestTimeline) => {
      pause();
      seek(request.endTime);
      setPeekLimit((limit) => Math.max(limit, liveEdgeRef.current));
      setFutureMode((mode) => (mode === 'shown' ? mode : 'peek'));
      // The seek decides where the terminal ends up; no scroll revert.
      setPaneRevertOnClose(false);
      setPaneRequest(null);
      setResumeOnPaneClose(false);
      setResumeOnListClose(false);
    },
    [pause, seek],
  );

  if (session.status === 'loading') {
    return (
      <Container size="sm" className={shared.pageState}>
        <Text c="dimmed">Loading the coding agent session…</Text>
      </Container>
    );
  }

  if (session.status === 'error' || !timeline) {
    return (
      <Container size="sm" className={shared.pageState}>
        <Alert color="red" title="Session unavailable">
          {session.status === 'error'
            ? session.error.message
            : 'The coding agent session could not be loaded.'}
        </Alert>
        {errorAction}
      </Container>
    );
  }

  // Shared header, identical in both layouts. The article-level heading
  // (`headerContent`) is page-supplied; the session selector belongs to the
  // experience.
  const header = (
    <header className={pageStyles.pageHeader}>
      {headerContent}
      <Group gap="xs">
        {sessions.length > 1 && (
          <Menu
            position="bottom-end"
            offset={6}
            width={360}
            withinPortal
            portalProps={{ target: portalTarget }}
          >
            <Menu.Target>
              <Button
                variant="default"
                size="xs"
                className={pageStyles.sessionSelector}
                rightSection={<span aria-hidden="true">▾</span>}
              >
                {selected.info.title}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Sessions</Menu.Label>
              {sessions.map((entry) => (
                <Menu.Item
                  key={entry.id}
                  rightSection={entry.id === selected.id ? '✓' : undefined}
                  onClick={() => onSelect(entry.id)}
                >
                  <SessionMenuLabel session={entry} />
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
    </header>
  );

  const playbackBar = (
    <PlaybackBar
      time={time}
      duration={duration}
      playing={playing}
      speed={speed}
      onToggle={handleToggle}
      onSpeedChange={setSpeed}
      onSeek={handleSeek}
    />
  );

  // Mobile: the terminal stands alone; the request list and pane live behind
  // the floating summary card as drawers over it. The playback bar stays
  // reachable below, so playback can be controlled while browsing requests.
  if (isMobile) {
    return (
      <Container size="xl" className={pageStyles.pageContainer}>
        {headerLead}
        {header}
        <div className={pageStyles.mobileTerminalArea}>
          <AgentTerminal
            timeline={timeline}
            states={entryStates}
            focusRequestId={paneRequest?.id ?? null}
            revertOnClose={paneRevertOnClose}
            highlightedEntryIds={paneHighlight.highlightIds}
            scrollAnchorEntryId={paneHighlight.anchorId}
            highlightVariant={paneSection === 'output' ? 'group' : 'boundary'}
          />
          <MobileRequestOverlay
            states={requestStates}
            breakdown={totals}
            showBreakdown={peakSentCount >= MOBILE_BREAKDOWN_AFTER_REQUESTS}
            totalRequests={timeline.requests.length}
            futureMode={futureMode}
            onFutureModeChange={setFutureMode}
            listOpen={listOpen}
            onListOpenChange={handleListOpenChange}
            onRequestTogglePane={handleRequestTogglePane}
            selectedRequestId={paneRequest?.id ?? null}
            paneRequest={paneRequest}
            session={session.session}
            expanded={paneSection}
            onExpand={setPaneSection}
            onGoto={handleRequestGoto}
            onClosePane={closePane}
          />
        </div>
        {playbackBar}
        {footerContent?.(session.session)}
      </Container>
    );
  }

  return (
    <Container size="xl" className={pageStyles.pageContainer}>
      {headerLead}
      {header}

      <div className={pageStyles.workbench}>
        <AgentTerminal
          timeline={timeline}
          states={entryStates}
          focusRequestId={paneRequest?.id ?? null}
          revertOnClose={paneRevertOnClose}
          highlightedEntryIds={paneHighlight.highlightIds}
          scrollAnchorEntryId={paneHighlight.anchorId}
          highlightVariant={paneSection === 'output' ? 'group' : 'boundary'}
        />
        <div className={pageStyles.requestArea}>
          <RequestList
            className={
              paneRequest
                ? `${pageStyles.requestListShell} ${pageStyles.requestListShifted}`
                : pageStyles.requestListShell
            }
            states={requestStates}
            breakdown={totals}
            totalRequests={timeline.requests.length}
            futureMode={futureMode}
            onFutureModeChange={setFutureMode}
            onRequestClick={handleRequestTogglePane}
            selectedRequestId={paneRequest?.id ?? null}
          />
          {paneRequest && (
            <RequestPane
              key={paneRequest.id}
              request={paneRequest}
              session={session.session}
              expanded={paneSection}
              onExpand={setPaneSection}
              onGoto={handleRequestGoto}
              onClose={closePane}
            />
          )}
        </div>
        {paneRequest && (
          <button
            type="button"
            className={pageStyles.paneBackdrop}
            aria-label="Close request details"
            tabIndex={-1}
            onClick={closePane}
          />
        )}
      </div>

      {playbackBar}
      {footerContent?.(session.session)}
    </Container>
  );
}
