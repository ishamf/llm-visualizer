import {
  Alert,
  Badge,
  Button,
  Container,
  Group,
  Text,
  Title,
} from '@mantine/core';
import { useCallback, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';

import { AgentTerminal } from '../coding-agent/AgentTerminal.tsx';
import { formatCost, formatTokens } from '../coding-agent/format.ts';
import { PlaybackBar } from '../coding-agent/PlaybackBar.tsx';
import { RequestList } from '../coding-agent/RequestList.tsx';
import {
  entriesAt,
  playbackDurationSeconds,
  requestsAt,
  usageBreakdownAt,
  type RequestTimeline,
} from '../coding-agent/timeline.ts';
import { useAgentSession } from '../coding-agent/use-agent-session.ts';
import { usePlayback } from '../coding-agent/use-playback.ts';
import shared from '../shared.module.css';
import styles from './CodingAgentPage.module.css';

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

export function CodingAgentPage() {
  const session = useAgentSession();
  const duration =
    session.status === 'ready' ? playbackDurationSeconds(session.timeline) : 0;
  const playback = usePlayback(duration, { autoPlay: true });
  // The individual functions are stable across renders; the hook result
  // object is not, so destructure before using them in callbacks.
  const { time, playing, speed, setSpeed, toggle, pause, seek } = playback;
  const ready = session.status === 'ready';
  const timeline = ready ? session.timeline : null;

  const entryStates = useMemo(
    () => (timeline ? entriesAt(timeline, time) : []),
    [timeline, time],
  );
  const requestStates = useMemo(
    () => (timeline ? requestsAt(timeline, time) : []),
    [timeline, time],
  );
  const totals = useMemo(
    () =>
      timeline
        ? usageBreakdownAt(timeline, time)
        : {
            cached: { tokens: 0, cost: 0 },
            cacheWrite: { tokens: 0, cost: 0 },
            input: { tokens: 0, cost: 0 },
            output: { tokens: 0, cost: 0 },
            total: { tokens: 0, cost: 0 },
          },
    [timeline, time],
  );
  const fullTotals = useMemo(
    () =>
      timeline
        ? usageBreakdownAt(timeline, Number.POSITIVE_INFINITY)
        : {
            cached: { tokens: 0, cost: 0 },
            cacheWrite: { tokens: 0, cost: 0 },
            input: { tokens: 0, cost: 0 },
            output: { tokens: 0, cost: 0 },
            total: { tokens: 0, cost: 0 },
          },
    [timeline],
  );

  useSpaceToggle(toggle, ready);

  const handleRequestClick = useCallback(
    (request: RequestTimeline) => {
      pause();
      seek(request.endTime);
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
              A recorded coding agent run, replayed token by token: thinking,
              tool calls, and edits on the left; the provider requests that
              produced them, with token counts and prices, on the right.
            </Text>
          </div>
          <Group gap="xs" className={styles.headerBadges}>
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
            onRequestClick={handleRequestClick}
          />
        </div>

        <PlaybackBar
          time={time}
          duration={duration}
          playing={playing}
          speed={speed}
          onToggle={toggle}
          onSpeedChange={setSpeed}
          onSeek={seek}
        />
      </Container>
    </main>
  );
}
