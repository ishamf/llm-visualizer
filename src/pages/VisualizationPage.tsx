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
import { GENERATED_DATA_BASE_URL } from '../data/dataset-catalog.ts';
import {
  HttpSummedContributionDataSource,
  LayerSummingContributionDataSource,
} from '../data/summed-contribution-data-source.ts';
import { useDatasetCatalog } from '../data/use-dataset-catalog.ts';
import { getConfiguredPromptTitle } from '../generation/prompts.ts';
import shared from '../shared.module.css';
import { ContributionGrid } from '../visualization/ContributionGrid.tsx';
import { ContributionText } from '../visualization/ContributionText.tsx';
import { getVisualization } from '../visualization/registry.ts';
import styles from './VisualizationPage.module.css';

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
  // The range control sums a selected span of layers. Summed datasets ship
  // their own per-layer generated-token matrices; layered-only datasets fall
  // back to summing the full layer matrices.
  const textLayerSource = useMemo(() => {
    if (summedSource) {
      return summedDataset?.manifest.layeredGeneratedContributions
        ? summedSource
        : null;
    }
    return layeredSource
      ? new LayerSummingContributionDataSource(layeredSource)
      : null;
  }, [summedSource, summedDataset, layeredSource]);
  const textSource = useMemo(
    () => summedSource ?? textLayerSource,
    [summedSource, textLayerSource],
  );
  const source =
    visualization?.kind === 'contribution-grid' ? layeredSource : textSource;

  if (catalog.status === 'loading') {
    return (
      <main className={shared.appShell}>
        <Container size="sm" className={shared.pageState}>
          <Text c="dimmed">Loading generated datasets…</Text>
        </Container>
      </main>
    );
  }

  if (!visualization || !dataset || !source) {
    return (
      <main className={shared.appShell}>
        <Container size="sm" className={shared.pageState}>
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
    <main className={shared.appShell}>
      <Container size="xl" className={styles.pageContainer}>
        <Button
          component={Link}
          to={import.meta.env.DEV ? '/dev/visualizations' : '/'}
          variant="subtle"
          size="compact-sm"
          className={shared.backLink}
        >
          ← Choose another view
        </Button>

        <header className={styles.pageHeader}>
          <div>
            <Text className={shared.eyebrow}>
              {dataset.manifest.model.id} · {dataset.manifest.geometry.layers}{' '}
              layers
            </Text>
            <Title order={1}>{visualization.label}</Title>
            <Text c="dimmed" maw={720}>
              {visualization.description}
            </Text>
          </div>
          <Group gap="xs" className={styles.headerBadges}>
            <Badge variant="light">
              {dataset.manifest.generation.method === 'sampling'
                ? `Sampled · seed ${dataset.manifest.generation.seed}`
                : 'Greedy generation'}
            </Badge>
            <Badge variant="outline">Unprojected contribution</Badge>
          </Group>
        </header>

        <Paper className={shared.datasetNote} radius="md" p="sm">
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
            <Paper className={styles.metricNote} radius="md" p="sm">
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
