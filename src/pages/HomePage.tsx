import { Button, Container, Text, Title } from '@mantine/core';
import { Link } from 'react-router-dom';

import { ContributionTextExperience } from '../ContributionTextExperience.tsx';
import { GENERATED_DATA_BASE_URL } from '../data/dataset-catalog.ts';
import { BROWSER_MODEL_SOURCE } from '../generation/browser-config.ts';
import shared from '../shared.module.css';
import styles from './HomePage.module.css';

function createStandaloneWorker() {
  return new Worker(
    new URL('../generation/browser-generation.worker.ts', import.meta.url),
    { type: 'module' },
  );
}

export function HomePage() {
  return (
    <main className={`${shared.appShell} ${styles.homepageShell}`}>
      <Container size="xl" className={styles.homepageContainer}>
        <header className={styles.homepageHeader}>
          <div>
            <Text className={shared.eyebrow}>LLM Visualizer</Text>
            <Title order={1}>Attention by token</Title>
            <Text c="dimmed" maw={720}>
              Choose an example or generate a response privately in your
              browser.
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
          modelSource={BROWSER_MODEL_SOURCE}
        />
      </Container>
    </main>
  );
}
