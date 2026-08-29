import {
  Button,
  Container,
  Paper,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { getBundledContributionDatasets } from '../data/bundled-contribution-data-source.ts';
import { getBundledSummedContributionDatasets } from '../data/bundled-summed-contribution-data-source.ts';
import { getConfiguredPromptTitle } from '../generation/prompts.ts';
import { VISUALIZATIONS } from '../visualization/registry.ts';

const layeredDatasets = getBundledContributionDatasets();
const summedDatasets = getBundledSummedContributionDatasets();

function datasetsForVisualization(visualizationId: string | null) {
  const visualization = VISUALIZATIONS.find(
    (candidate) => candidate.id === visualizationId,
  );
  if (visualization?.preferredFormat === 'layered') return layeredDatasets;

  const summedIds = new Set(summedDatasets.map(({ id }) => id));
  return [
    ...summedDatasets,
    ...layeredDatasets.filter(({ id }) => !summedIds.has(id)),
  ];
}

export function DevVisualizationSelectorPage() {
  const navigate = useNavigate();
  const [visualizationId, setVisualizationId] = useState<string | null>(
    VISUALIZATIONS[0]?.id ?? null,
  );
  const datasets = datasetsForVisualization(visualizationId);
  const [datasetId, setDatasetId] = useState<string | null>(
    datasetsForVisualization(VISUALIZATIONS[0]?.id ?? null)[0]?.id ?? null,
  );
  const selectedVisualization = VISUALIZATIONS.find(
    (visualization) => visualization.id === visualizationId,
  );
  const selectedDataset = datasets.find((dataset) => dataset.id === datasetId);

  const viewVisualization = () => {
    if (!visualizationId || !datasetId) return;
    navigate(
      `/visualizations/${encodeURIComponent(visualizationId)}/${encodeURIComponent(datasetId)}`,
    );
  };

  const selectVisualization = (value: string | null) => {
    setVisualizationId(value);
    const compatibleDatasets = datasetsForVisualization(value);
    if (!compatibleDatasets.some(({ id }) => id === datasetId)) {
      setDatasetId(compatibleDatasets[0]?.id ?? null);
    }
  };

  return (
    <main className="app-shell home-shell">
      <Container size="sm" className="home-container">
        <Button
          component={Link}
          to="/"
          variant="subtle"
          size="compact-sm"
          className="back-link"
        >
          ← Back to homepage
        </Button>
        <header className="home-header">
          <Text className="eyebrow">Developer tools</Text>
          <Title order={1}>Choose what to explore</Title>
          <Text c="dimmed" maw={620}>
            Pair a visualization with one of the generated model runs bundled
            into this build.
          </Text>
        </header>

        <Paper className="selector-card" withBorder radius="lg" p="xl">
          <Stack gap="lg">
            <Select
              label="Visualization"
              description={selectedVisualization?.description}
              placeholder="Select a visualization"
              data={VISUALIZATIONS.map(({ id, label }) => ({
                value: id,
                label,
              }))}
              value={visualizationId}
              onChange={selectVisualization}
              allowDeselect={false}
            />

            <Select
              label="Generated data"
              description={
                selectedDataset
                  ? `${selectedDataset.manifest.model.id} · ${selectedDataset.manifest.tokens.length} tokens · ${selectedDataset.manifest.geometry.layers} layers`
                  : 'Select a generated model run'
              }
              placeholder="Select generated data"
              data={datasets.map(({ id, manifest }) => ({
                value: id,
                label: `${manifest.title ?? getConfiguredPromptTitle(id) ?? manifest.prompt} — ${id}`,
              }))}
              value={datasetId}
              onChange={setDatasetId}
              allowDeselect={false}
            />

            <Button
              size="md"
              disabled={!visualizationId || !datasetId}
              onClick={viewVisualization}
            >
              View
            </Button>
          </Stack>
        </Paper>
      </Container>
    </main>
  );
}
