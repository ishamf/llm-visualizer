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

import { HttpContributionDataSource } from '../data/contribution-data-source.ts';
import {
  matchingLayeredDataset,
  GENERATED_DATA_BASE_URL,
} from '../data/dataset-catalog.ts';
import {
  HttpSummedContributionDataSource,
  LayerSummingContributionDataSource,
} from '../data/summed-contribution-data-source.ts';
import { useDatasetCatalog } from '../data/use-dataset-catalog.ts';
import { getConfiguredPromptTitle } from '../generation/prompts.ts';
import { ContributionGrid } from '../visualization/ContributionGrid.tsx';
import { ContributionText } from '../visualization/ContributionText.tsx';
import { getVisualization } from '../visualization/registry.ts';

export function VisualizationPage() {
  const { visualizationId = '', datasetId = '' } = useParams();
  const catalog = useDatasetCatalog(GENERATED_DATA_BASE_URL);
  const visualization = getVisualization(visualizationId);
  const layeredDataset = catalog.datasets.find(
    (candidate) => candidate.format === 'layered' && candidate.id === datasetId,
  );
  const summedDataset = catalog.datasets.find(
    (candidate) => candidate.format === 'summed' && candidate.id === datasetId,
  );
  const dataset =
    visualization?.preferredFormat === 'layered'
      ? layeredDataset
      : (summedDataset ?? layeredDataset);
  const layeredSource = useMemo(
    () =>
      layeredDataset
        ? new HttpContributionDataSource(
            layeredDataset.id,
            layeredDataset.baseUrl,
            layeredDataset.manifest,
          )
        : null,
    [layeredDataset],
  );
  const summedSource = useMemo(
    () =>
      summedDataset
        ? new HttpSummedContributionDataSource(
            summedDataset.id,
            summedDataset.baseUrl,
            summedDataset.manifest,
          )
        : null,
    [summedDataset],
  );
  // Layered data lets the contribution-text view re-sum a selected range of
  // layers; a single instance backs both the full sum and the range control
  // so layer downloads are shared.
  const textLayerSource = useMemo(
    () =>
      layeredSource &&
      dataset &&
      matchingLayeredDataset(dataset, catalog.datasets)
        ? new LayerSummingContributionDataSource(layeredSource)
        : null,
    [catalog.datasets, dataset, layeredSource],
  );
  const textSource = useMemo(
    () => summedSource ?? textLayerSource,
    [summedSource, textLayerSource],
  );
  const source =
    visualization?.kind === 'contribution-grid' ? layeredSource : textSource;

  if (catalog.status === 'loading') {
    return (
      <main className="app-shell">
        <Container size="sm" className="page-state">
          <Text c="dimmed">Loading generated datasets…</Text>
        </Container>
      </main>
    );
  }

  if (!visualization || !dataset || !source) {
    return (
      <main className="app-shell">
        <Container size="sm" className="page-state">
          <Alert color="red" title="Visualization not found">
            {catalog.status === 'error'
              ? catalog.error.message
              : 'This visualization or generated dataset is not available.'}
          </Alert>
          <Button
            component={Link}
            to={import.meta.env.DEV ? '/dev/visualizations' : '/'}
            variant="light"
          >
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
          to={import.meta.env.DEV ? '/dev/visualizations' : '/'}
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
            <Badge variant="light">
              {dataset.manifest.generation.method === 'sampling'
                ? `Sampled · seed ${dataset.manifest.generation.seed}`
                : 'Greedy generation'}
            </Badge>
            <Badge variant="outline">Unprojected contribution</Badge>
          </Group>
        </header>

        <Paper className="dataset-note" radius="md" p="sm">
          <Text size="xs" c="dimmed">
            Generated data
          </Text>
          <Text size="sm" fw={600}>
            {dataset.manifest.title ??
              getConfiguredPromptTitle(dataset.id) ??
              dataset.manifest.prompt}
          </Text>
        </Paper>

        {visualization.kind === 'contribution-grid' ? (
          <>
            <Paper className="metric-note" radius="md" p="sm">
              <Text size="sm">
                Circles are token positions. Hover a circle to reveal its
                strongest causal source contributions; line width shows relative
                magnitude within that destination row. Click to pin, and press
                Escape to clear.
              </Text>
            </Paper>
            <ContributionGrid source={layeredSource!} />
          </>
        ) : (
          <ContributionText
            key={dataset.id}
            source={textSource!}
            layerSource={textLayerSource ?? undefined}
            manifest={dataset.manifest}
          />
        )}
      </Container>
    </main>
  );
}
