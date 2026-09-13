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
  const { time, playing, speed, setSpeed, toggle, pause, seek } = playback;
  const ready = session.status === 'ready';
  const timeline = ready ? session.timeline : null;

  // Future requests are normally hidden. Clicking a request shows them in a
  // temporary "peek" mode (the checkbox renders indeterminate) until the user
  // plays or seeks; the checkbox flips into a permanent "shown" mode.
  const [futureMode, setFutureMode] = useState<FutureRequestsMode>('hidden');

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

  const handleToggle = useCallback(() => {
    toggle();
    clearPeek();
  }, [toggle, clearPeek]);

  const handleSeek = useCallback(
    (value: number) => {
      seek(value);
      clearPeek();
    },
    [seek, clearPeek],
  );

  useSpaceToggle(handleToggle, ready);

  const handleRequestClick = useCallback(
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
          <RequestList
            states={requestStates}
            breakdown={totals}
            totalRequests={timeline.requests.length}
            futureMode={futureMode}
            onFutureModeChange={setFutureMode}
            onRequestClick={handleRequestClick}
          />
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
