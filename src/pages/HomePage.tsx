import { Button, Container, Text, Title } from '@mantine/core';
import { Link } from 'react-router-dom';

import { ContributionTextExperience } from '../ContributionTextExperience.tsx';
import { GENERATED_DATA_BASE_URL } from '../data/dataset-catalog.ts';
import { BROWSER_MODEL_ROOT } from '../generation/config.ts';

function createStandaloneWorker() {
  return new Worker(
    new URL('../generation/browser-generation.worker.ts', import.meta.url),
    { type: 'module' },
  );
}

export function HomePage() {
  return (
    <main className="app-shell homepage-shell">
      <Container size="xl" className="homepage-container">
        <header className="homepage-header">
          <div>
            <Text className="eyebrow">LLM Visualizer</Text>
            <Title order={1}>See what shaped each token</Title>
            <Text c="dimmed" maw={720}>
              Explore how earlier words contributed to a model response, or
              generate a new response privately in your browser.
            </Text>
          </div>
          {import.meta.env.DEV && (
            <Button
              component={Link}
              to="/dev/visualizations"
              variant="subtle"
              size="compact-sm"
            >
              View other visualizations
            </Button>
          )}
        </header>

        <ContributionTextExperience
          createWorker={createStandaloneWorker}
          generatedDataBaseUrl={GENERATED_DATA_BASE_URL}
          modelBaseUrl={BROWSER_MODEL_ROOT}
        />
      </Container>
    </main>
  );
}
