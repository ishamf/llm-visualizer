import { Button, Container } from '@mantine/core';
import { Link } from 'react-router-dom';

import { ContributionTextExperience } from '../ContributionTextExperience.tsx';
import { GENERATED_DATA_BASE_URL } from '../data/dataset-catalog.ts';
import { BROWSER_MODEL_SOURCE } from '../generation/browser-config.ts';
import shared from '../shared.module.css';
import styles from './ContributionTextPage.module.css';

function createStandaloneWorker() {
  return new Worker(
    new URL('../generation/browser-generation.worker.ts', import.meta.url),
    { type: 'module' },
  );
}

export function ContributionTextPage() {
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

        <ContributionTextExperience
          createWorker={createStandaloneWorker}
          generatedDataBaseUrl={GENERATED_DATA_BASE_URL}
          modelSource={BROWSER_MODEL_SOURCE}
        />
      </Container>
    </main>
  );
}
