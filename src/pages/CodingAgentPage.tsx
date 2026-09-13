import {
  Alert,
  Badge,
  Button,
  Container,
  Group,
  Menu,
  Text,
  Title,
} from '@mantine/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { AgentTerminal } from '../coding-agent/AgentTerminal.tsx';
import {
  formatClock,
  formatCost,
  formatTokens,
} from '../coding-agent/format.ts';
import { PlaybackBar } from '../coding-agent/PlaybackBar.tsx';
import { RequestPane } from '../coding-agent/RequestPane.tsx';
import {
  RequestList,
  type FutureRequestsMode,
} from '../coding-agent/RequestList.tsx';
import type { SessionIndexEntry } from '../coding-agent/session-index.ts';
import { sessionUrl } from '../coding-agent/session-urls.ts';
import {
  entriesAt,
  playbackDurationSeconds,
  requestsAt,
  usageBreakdownAt,
  type RequestTimeline,
} from '../coding-agent/timeline.ts';
import { useAgentSession } from '../coding-agent/use-agent-session.ts';
import { usePlayback } from '../coding-agent/use-playback.ts';
import { useSessionIndex } from '../coding-agent/use-session-index.ts';
import shared from '../shared.module.css';
import styles from './CodingAgentPage.module.css';

const DEFAULT_DESCRIPTION =
  'A recorded coding agent run, replayed token by token: thinking, tool calls, and edits on the left; the provider requests that produced them, with token counts and prices, on the right.';

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
        target.closest(
          'button, input, textarea, select, [role="slider"], [role="button"]',
        )
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
    <span className={styles.sessionMenuItem}>
      <span className={styles.sessionMenuTitle}>{session.info.title}</span>
      <span className={styles.sessionMenuMeta}>
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

export function CodingAgentPage() {
  const indexState = useSessionIndex();
  const [searchParams, setSearchParams] = useSearchParams();

  if (indexState.status === 'loading') {
    return (
      <main className={shared.appShell}>
        <Container size="sm" className={shared.pageState}>
          <Text c="dimmed">Loading the coding agent sessions…</Text>
        </Container>
      </main>
    );
  }

  if (indexState.status === 'error') {
    return (
      <main className={shared.appShell}>
        <Container size="sm" className={shared.pageState}>
          <Alert color="red" title="Sessions unavailable">
            {indexState.error.message}
          </Alert>
          <Button component={Link} to="/" variant="light">
            Back to homepage
          </Button>
        </Container>
      </main>
    );
  }

  const sessions = indexState.index.sessions;
  if (sessions.length === 0) {
    return (
      <main className={shared.appShell}>
        <Container size="sm" className={shared.pageState}>
          <Alert color="red" title="Sessions unavailable">
            No coding agent sessions were found in the session index.
          </Alert>
          <Button component={Link} to="/" variant="light">
            Back to homepage
          </Button>
        </Container>
      </main>
    );
  }

  const requestedId = searchParams.get('session');
  const selected =
    sessions.find((session) => session.id === requestedId) ?? sessions[0];

  const selectSession = (id: string) => {
    setSearchParams(id === sessions[0].id ? {} : { session: id });
  };

  return (
    <SessionReplay
      key={selected.id}
      sessions={sessions}
      selected={selected}
      onSelect={selectSession}
    />
  );
}

function SessionReplay({
  sessions,
  selected,
  onSelect,
}: {
  sessions: readonly SessionIndexEntry[];
  selected: SessionIndexEntry;
  onSelect: (id: string) => void;
}) {
  const session = useAgentSession(sessionUrl(selected));
  const duration =
    session.status === 'ready' ? playbackDurationSeconds(session.timeline) : 0;
  const playback = usePlayback(duration, { autoPlay: true });
  // The individual functions are stable across renders; the hook result
  // object is not, so destructure before using them in callbacks.
  const { time, playing, speed, setSpeed, toggle, play, pause, seek } =
    playback;
  const ready = session.status === 'ready';
  const timeline = ready ? session.timeline : null;

  // Future requests are normally hidden. Jumping to an earlier request (the
  // ⤓ button) shows them in a temporary "peek" mode (the checkbox renders
  // indeterminate) until the user plays or seeks; the checkbox flips into a
  // permanent "shown" mode.
  const [futureMode, setFutureMode] = useState<FutureRequestsMode>('hidden');
  // The request pane shows one request's payloads. It is keyed per request,
  // so opening another one resets its accordion.
  const [paneRequest, setPaneRequest] = useState<RequestTimeline | null>(null);
  // Whether playback was running when the pane opened, so closing it can
  // resume. Set only on the open transition (switching requests keeps it);
  // manual play/pause while the pane is open cancels it.
  const [resumeOnPaneClose, setResumeOnPaneClose] = useState(false);

  const entryStates = useMemo(
    () => (timeline ? entriesAt(timeline, time) : []),
    [timeline, time],
  );
  const requestStates = useMemo(
    () =>
      timeline
        ? requestsAt(timeline, time, { includeFuture: futureMode !== 'hidden' })
        : [],
    [timeline, time, futureMode],
  );
  const totals = useMemo(
    () => (timeline ? usageBreakdownAt(timeline, time) : EMPTY_BREAKDOWN),
    [timeline, time],
  );
  const fullTotals = useMemo(
    () =>
      timeline
        ? usageBreakdownAt(timeline, Number.POSITIVE_INFINITY)
        : EMPTY_BREAKDOWN,
    [timeline],
  );

  const clearPeek = useCallback(
    () => setFutureMode((mode) => (mode === 'peek' ? 'hidden' : mode)),
    [],
  );

  // Manual play/pause while the pane is open discards the resume-on-close
  // intent: the user has taken over playback.
  const handleToggle = useCallback(() => {
    if (paneRequest) setResumeOnPaneClose(false);
    toggle();
    clearPeek();
  }, [paneRequest, toggle, clearPeek]);

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

  // Clicking a card toggles the request pane. Opening it pauses playback,
  // remembering whether it was running so closing can resume; switching
  // requests leaves the pause state untouched.
  const handleRequestTogglePane = useCallback(
    (request: RequestTimeline) => {
      if (paneRequest) {
        if (paneRequest.id === request.id) closePane();
        else setPaneRequest(request);
        return;
      }
      setResumeOnPaneClose(playing);
      pause();
      setPaneRequest(request);
    },
    [paneRequest, playing, pause, closePane],
  );

  // The ⤓ button on a card jumps to when that request's response finished
  // streaming: pause, seek, and reveal the later requests in the temporary
  // peek mode (unless "Show all requests" already pins them).
  const handleRequestSeek = useCallback(
    (request: RequestTimeline) => {
      pause();
      seek(request.endTime);
      setFutureMode((mode) => (mode === 'shown' ? mode : 'peek'));
    },
    [pause, seek],
  );

  if (session.status === 'loading') {
    return (
      <main className={shared.appShell}>
        <Container size="sm" className={shared.pageState}>
          <Text c="dimmed">Loading the coding agent session…</Text>
        </Container>
      </main>
    );
  }

  if (session.status === 'error' || !timeline) {
    return (
      <main className={shared.appShell}>
        <Container size="sm" className={shared.pageState}>
          <Alert color="red" title="Session unavailable">
            {session.status === 'error'
              ? session.error.message
              : 'The coding agent session could not be loaded.'}
          </Alert>
          <Button component={Link} to="/" variant="light">
            Back to homepage
          </Button>
        </Container>
      </main>
    );
  }

  return (
    <main className={shared.appShell}>
      <Container size="xl" className={styles.pageContainer}>
        <Button
          component={Link}
          to="/"
          variant="subtle"
          size="compact-sm"
          className={shared.backLink}
        >
          ← Back to homepage
        </Button>

        <header className={styles.pageHeader}>
          <div>
            <Text className={shared.eyebrow}>Coding agent</Text>
            <Title order={1}>Agent session replay</Title>
            <Text c="dimmed" maw={720}>
              {DEFAULT_DESCRIPTION}
            </Text>
          </div>
          <Group gap="xs" className={styles.headerBadges}>
            {sessions.length > 1 && (
              <Menu position="bottom-end" offset={6} width={360} withinPortal>
                <Menu.Target>
                  <Button
                    variant="default"
                    size="xs"
                    className={styles.sessionSelector}
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
            <Badge variant="light">{timeline.model}</Badge>
            <Badge variant="outline">{timeline.requests.length} requests</Badge>
            <Badge variant="outline">
              {formatTokens(fullTotals.output.tokens)} output tokens
            </Badge>
            <Badge variant="outline">{formatCost(fullTotals.total.cost)}</Badge>
          </Group>
        </header>

        <div className={styles.workbench}>
          <AgentTerminal timeline={timeline} states={entryStates} />
          <div className={styles.requestArea}>
            <RequestList
              className={
                paneRequest
                  ? `${styles.requestListShell} ${styles.requestListShifted}`
                  : styles.requestListShell
              }
              states={requestStates}
              breakdown={totals}
              totalRequests={timeline.requests.length}
              futureMode={futureMode}
              onFutureModeChange={setFutureMode}
              onRequestClick={handleRequestTogglePane}
              onRequestSeek={handleRequestSeek}
              selectedRequestId={paneRequest?.id ?? null}
            />
            {paneRequest && (
              <RequestPane
                key={paneRequest.id}
                request={paneRequest}
                session={session.session}
                onClose={closePane}
              />
            )}
          </div>
          {paneRequest && (
            <button
              type="button"
              className={styles.paneBackdrop}
              aria-label="Close request details"
              tabIndex={-1}
              onClick={closePane}
            />
          )}
        </div>

        <PlaybackBar
          time={time}
          duration={duration}
          playing={playing}
          speed={speed}
          onToggle={handleToggle}
          onSpeedChange={setSpeed}
          onSeek={handleSeek}
        />
      </Container>
    </main>
  );
}
