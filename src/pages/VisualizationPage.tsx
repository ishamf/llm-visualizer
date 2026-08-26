import {
  Alert,
  Badge,
  Button,
  Container,
  Group,
  Paper,
  Text,
  Title,
} from '@mantine/core';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  BundledContributionDataSource,
  getBundledContributionDatasets,
} from '../data/bundled-contribution-data-source.ts';
import { ContributionGrid } from '../visualization/ContributionGrid.tsx';
import { getVisualization } from '../visualization/registry.ts';

export function VisualizationPage() {
  const { visualizationId = '', datasetId = '' } = useParams();
  const visualization = getVisualization(visualizationId);
  const dataset = getBundledContributionDatasets().find(
    (candidate) => candidate.id === datasetId,
  );
  const source = useMemo(
    () => (dataset ? new BundledContributionDataSource(dataset.id) : null),
    [dataset],
  );

  if (!visualization || !dataset || !source) {
    return (
      <main className="app-shell">
        <Container size="sm" className="page-state">
          <Alert color="red" title="Visualization not found">
            This visualization or generated dataset is not available in this
            build.
          </Alert>
          <Button component={Link} to="/" variant="light">
            Back to selector
          </Button>
        </Container>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <Container size="xl" className="page-container">
        <Button
          component={Link}
          to="/"
          variant="subtle"
          size="compact-sm"
          className="back-link"
        >
          ← Choose another view
        </Button>

        <header className="page-header">
          <div>
            <Text className="eyebrow">
              {dataset.manifest.model.id} · {dataset.manifest.geometry.layers}{' '}
              layers
            </Text>
            <Title order={1}>{visualization.label}</Title>
            <Text c="dimmed" maw={720}>
              {visualization.description}
            </Text>
          </div>
          <Group gap="xs" className="header-badges">
            <Badge variant="light">Greedy generation</Badge>
            <Badge variant="outline">Unprojected contribution</Badge>
          </Group>
        </header>

        <Paper className="dataset-note" radius="md" p="sm">
          <Text size="xs" c="dimmed">
            Generated data
          </Text>
          <Text size="sm" fw={600}>
            {dataset.manifest.prompt}
          </Text>
        </Paper>

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
