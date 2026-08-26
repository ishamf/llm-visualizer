import { Badge, Container, Group, Paper, Text, Title } from '@mantine/core';
import { useMemo } from 'react';

import { BundledContributionDataSource } from './data/bundled-contribution-data-source.ts';
import { ContributionGrid } from './visualization/ContributionGrid.tsx';
import './App.css';

function App() {
  const source = useMemo(() => new BundledContributionDataSource('multiplication-place-values'), []);

  return (
    <main className="app-shell">
      <Container size="xl" className="page-container">
        <header className="page-header">
          <div>
            <Text className="eyebrow">Qwen3-0.6B · 28 layers</Text>
            <Title order={1}>Attention contribution explorer</Title>
            <Text c="dimmed" maw={720}>
              Follow how much value-vector magnitude each earlier token supplies
              to a destination token at every transformer layer.
            </Text>
          </div>
          <Group gap="xs" className="header-badges">
            <Badge variant="light">Greedy generation</Badge>
            <Badge variant="outline">Unprojected contribution</Badge>
          </Group>
        </header>

        <Paper className="metric-note" radius="md" p="sm">
          <Text size="sm">
            Circles are token positions. Hover a circle to reveal its strongest
            causal source contributions; line width shows relative magnitude
            within that destination row. Click to pin, and press Escape to
            clear.
          </Text>
        </Paper>

        <ContributionGrid source={source} />
      </Container>
    </main>
  );
}

export default App;
