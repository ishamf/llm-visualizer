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
  timeAtTokens,
  tokensAt,
  usageTotalsAt,
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
  const { time, playing, toggle, pause, seek } = playback;
  const ready = session.status === 'ready';
  const timeline = ready ? session.timeline : null;

  const tokens = tokensAt(time);
  const entryStates = useMemo(
    () => (timeline ? entriesAt(timeline, tokens) : []),
    [timeline, tokens],
  );
  const requestStates = useMemo(
    () => (timeline ? requestsAt(timeline, tokens) : []),
    [timeline, tokens],
  );
  const totals = useMemo(
    () =>
      timeline
        ? usageTotalsAt(timeline, tokens)
        : { input: 0, output: 0, cost: 0 },
    [timeline, tokens],
  );
  const fullTotals = useMemo(
    () =>
      timeline
        ? usageTotalsAt(timeline, Number.POSITIVE_INFINITY)
        : { input: 0, output: 0, cost: 0 },
    [timeline],
  );

  useSpaceToggle(toggle, ready);

  const handleRequestClick = useCallback(
    (request: RequestTimeline) => {
      pause();
      seek(timeAtTokens(request.end));
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
              {formatTokens(fullTotals.output)} output tokens
            </Badge>
            <Badge variant="outline">{formatCost(fullTotals.cost)}</Badge>
          </Group>
        </header>

        <div className={styles.workbench}>
          <AgentTerminal timeline={timeline} states={entryStates} />
          <RequestList
            states={requestStates}
            totals={totals}
            totalRequests={timeline.requests.length}
            onRequestClick={handleRequestClick}
          />
        </div>

        <PlaybackBar
          time={time}
          duration={duration}
          playing={playing}
          onToggle={toggle}
          onSeek={seek}
        />
      </Container>
    </main>
  );
}
