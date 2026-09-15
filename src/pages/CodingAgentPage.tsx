import { Button, Text, Title } from '@mantine/core';
import { Link, useSearchParams } from 'react-router-dom';

import { CodingAgentExperience } from '../CodingAgentExperience.tsx';
import shared from '../shared.module.css';
import {
  ContextCostChart,
  ContextCostWindowChart,
} from './ContextCostChart.tsx';

const DEFAULT_DESCRIPTION =
  'A recorded coding agent run, replayed token by token: thinking, tool calls, and edits on the left; the provider requests that produced them, with token counts and prices, on the right.';

export function CodingAgentPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <main className={shared.appShell}>
      <CodingAgentExperience
        errorAction={
          <Button component={Link} to="/" variant="light">
            Back to homepage
          </Button>
        }
        headerContent={
          <div>
            <Text className={shared.eyebrow}>Coding agent</Text>
            <Title order={1}>Agent session replay</Title>
            <Text c="dimmed" maw={720}>
              {DEFAULT_DESCRIPTION}
            </Text>
          </div>
        }
        headerLead={
          <Button
            component={Link}
            to="/"
            variant="subtle"
            size="compact-sm"
            className={shared.backLink}
          >
            ← Back to homepage
          </Button>
        }
        footerContent={(session) => (
          <>
            <ContextCostChart session={session} />
            <ContextCostWindowChart session={session} />
          </>
        )}
        onSessionSelect={(sessionId) =>
          setSearchParams(sessionId ? { session: sessionId } : {})
        }
        sessionId={searchParams.get('session')}
      />
    </main>
  );
}
