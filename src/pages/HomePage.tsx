import { Badge, Container, Text, Title, UnstyledButton } from '@mantine/core';
import { Link } from 'react-router-dom';

import shared from '../shared.module.css';
import styles from './HomePage.module.css';

type ExperienceCardProps = {
  to: string;
  eyebrow: string;
  title: string;
  description: string;
  badge?: string;
  dashed?: boolean;
};

function ExperienceCard({
  to,
  eyebrow,
  title,
  description,
  badge,
  dashed = false,
}: ExperienceCardProps) {
  return (
    <UnstyledButton
      component={Link}
      to={to}
      className={styles.experienceCard}
      data-dashed={dashed || undefined}
    >
      <span className={styles.cardEyebrow}>{eyebrow}</span>
      <span className={styles.cardTitleRow}>
        <span className={styles.cardTitle}>{title}</span>
        {badge && (
          <Badge size="sm" variant="light" color="violet">
            {badge}
          </Badge>
        )}
      </span>
      <span className={styles.cardDescription}>{description}</span>
      <span className={styles.cardArrow} aria-hidden="true">
        →
      </span>
    </UnstyledButton>
  );
}

export function HomePage() {
  return (
    <main className={`${shared.appShell} ${styles.homepageShell}`}>
      <Container size="lg" className={styles.homepageContainer}>
        <header className={styles.homepageHeader}>
          <Text className={shared.eyebrow}>LLM Visualizer</Text>
          <Title order={1}>Explore language model internals</Title>
          <Text c="dimmed" maw={720}>
            Pick an experience: watch attention shape generated text, or replay
            a coding agent session request by request.
          </Text>
        </header>

        <div className={styles.experienceGrid}>
          <ExperienceCard
            to="/attention"
            eyebrow="Attention"
            title="Contribution text"
            description="Read prompts and generated responses while token opacity reveals the strongest attention contributions, summed across every layer."
          />
          <ExperienceCard
            to="/coding-agent"
            eyebrow="Agent runtime"
            title="Coding agent"
            description="Replay a recorded coding agent session: streaming thinking, tool calls, and edits beside the provider requests that produced them."
          />
          {import.meta.env.DEV && (
            <ExperienceCard
              to="/dev/visualizations"
              eyebrow="Developer tools"
              title="Experimental"
              description="Explore other visualizations paired with pre-generated model runs bundled into this build."
              badge="Dev"
              dashed
            />
          )}
        </div>
      </Container>
    </main>
  );
}
