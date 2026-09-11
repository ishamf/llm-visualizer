import { Paper, Popover, Text, Title, UnstyledButton } from '@mantine/core';
import { useState } from 'react';

import type { RemoteDataset } from './data/dataset-catalog.ts';
import { HttpSummedContributionDataSource } from './data/summed-contribution-data-source.ts';
import { useDatasetCatalog } from './data/use-dataset-catalog.ts';
import type { BrowserModelSource } from './generation/browser-config.ts';
import { isCrossOriginIsolated } from './generation/cross-origin-isolation.ts';
import { getConfiguredPromptTitle } from './generation/prompts.ts';
import {
  BrowserGenerationPanel,
  type GenerationResult,
} from './pages/GenerationPage.tsx';
import { selectDefaultPromptId } from './pages/homepage-state.ts';
import shared from './shared.module.css';
import { ContributionText } from './visualization/ContributionText.tsx';
import styles from './ContributionTextExperience.module.css';

type ContributionTextExperienceProps = {
  createWorker: () => Worker;
  /**
   * True when rendered inside the web component on a host page that does not
   * control the response headers. Enables the reduced-performance warning when
   * the host page is not cross-origin isolated.
   */
  embedded?: boolean;
  generatedDataBaseUrl: string;
  modelSource: BrowserModelSource;
};

function RemoteContributionText({
  dataset,
  playing,
  onPlayingChange,
}: {
  dataset: RemoteDataset;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
}) {
  const [source] = useState(
    () =>
      new HttpSummedContributionDataSource(
        dataset.id,
        dataset.baseUrl,
        dataset.manifest,
      ),
  );
  return (
    <ContributionText
      source={source}
      manifest={dataset.manifest}
      showOpacityControls={false}
      playing={playing}
      onPlayingChange={onPlayingChange}
    />
  );
}

export function ContributionTextExperience({
  createWorker,
  embedded = false,
  generatedDataBaseUrl,
  modelSource,
}: ContributionTextExperienceProps) {
  const catalog = useDatasetCatalog(generatedDataBaseUrl);
  const datasets = catalog.datasets.filter(({ format }) => format === 'summed');
  const [requestedDatasetId, setRequestedDatasetId] = useState('');
  const datasetId = datasets.some(({ id }) => id === requestedDatasetId)
    ? requestedDatasetId
    : selectDefaultPromptId(datasets.map(({ id }) => id));
  const [generationResult, setGenerationResult] = useState<GenerationResult>();
  const [generationStarted, setGenerationStarted] = useState(false);
  const [generationActive, setGenerationActive] = useState(false);
  const [presetVisualizationPlaying, setPresetVisualizationPlaying] =
    useState(true);
  const [customVisualizationPlaying, setCustomVisualizationPlaying] =
    useState(false);
  const [promptSelectorOpen, setPromptSelectorOpen] = useState(false);
  const selectedDataset = datasets.find(({ id }) => id === datasetId);

  const handleGenerationStarted = () => {
    setGenerationStarted(true);
    setCustomVisualizationPlaying(false);
  };
  const handleResultChange = (result: GenerationResult | undefined) =>
    setGenerationResult(result);
  const selectDataset = (id: string) => {
    setRequestedDatasetId(id);
    setPromptSelectorOpen(false);
  };

  const promptOptions = datasets.map(({ id, manifest }) => {
    const selected = id === datasetId;
    const generatedTokens = manifest.tokens.length - manifest.promptTokenCount;
    return (
      <UnstyledButton
        key={id}
        className={`${styles.promptOption} ${selected ? styles.selectedPromptOption : ''}`}
        role="listitem"
        aria-pressed={selected}
        onClick={() => selectDataset(id)}
      >
        <Text fw={650} size="sm">
          {manifest.title ?? getConfiguredPromptTitle(id) ?? manifest.prompt}
        </Text>
        <Text size="xs" c="dimmed">
          {generatedTokens} generated token{generatedTokens === 1 ? '' : 's'}
        </Text>
      </UnstyledButton>
    );
  });

  return (
    <div className={styles.contributionTextExperience}>
      <div className={styles.experiencePrimary}>
        <section
          className={styles.promptPicker}
          aria-labelledby="prompt-picker-title"
        >
          <div>
            <Text className={shared.eyebrow}>Pre-generated examples</Text>
            <Title order={2} id="prompt-picker-title">
              Pick a prompt
            </Title>
            <Text c="dimmed" size="sm">
              These examples are ready immediately.
            </Text>
          </div>
          <div className={styles.promptList} role="list">
            {promptOptions}
          </div>
        </section>

        <section className={styles.homepageVisualization} aria-live="polite">
          <header className={styles.generationResultHeader}>
            <div>
              <Text className={shared.eyebrow}>Pre-generated attention</Text>
              <Title order={2}>Attention by token</Title>
            </div>
            <Text size="sm" c="dimmed">
              {selectedDataset
                ? `${selectedDataset.manifest.model.id} · ${selectedDataset.manifest.geometry.layers} layers`
                : ''}
            </Text>
          </header>

          {catalog.status === 'error' ? (
            <Paper
              className={shared.textVisualizationState}
              withBorder
              radius="lg"
              p="xl"
            >
              <Text size="sm" c="red">
                {catalog.error.message}
              </Text>
            </Paper>
          ) : selectedDataset ? (
            <>
              <Popover
                opened={promptSelectorOpen}
                onChange={setPromptSelectorOpen}
                position="bottom-start"
                width="target"
                shadow="md"
                withinPortal={false}
              >
                <Popover.Target>
                  <UnstyledButton
                    className={`${shared.datasetNote} ${styles.mobilePromptSelector}`}
                    aria-label="Select a pre-generated prompt"
                    aria-expanded={promptSelectorOpen}
                    aria-haspopup="dialog"
                    onClick={() => setPromptSelectorOpen((open) => !open)}
                  >
                    <span>
                      <Text size="xs" c="dimmed">
                        Selected prompt
                      </Text>
                      <Text size="sm" fw={600}>
                        {selectedDataset.manifest.title ??
                          getConfiguredPromptTitle(selectedDataset.id) ??
                          selectedDataset.manifest.prompt}
                      </Text>
                    </span>
                    <span aria-hidden="true">⌄</span>
                  </UnstyledButton>
                </Popover.Target>
                <Popover.Dropdown
                  className={styles.mobilePromptPopover}
                  role="dialog"
                  aria-label="Choose a pre-generated prompt"
                >
                  <div className={styles.promptList} role="list">
                    {promptOptions}
                  </div>
                </Popover.Dropdown>
              </Popover>
              <RemoteContributionText
                key={selectedDataset.id}
                dataset={selectedDataset}
                playing={presetVisualizationPlaying}
                onPlayingChange={setPresetVisualizationPlaying}
              />
            </>
          ) : (
            <Paper
              className={shared.textVisualizationState}
              withBorder
              radius="lg"
              p="xl"
            >
              <Text size="sm" c="dimmed">
                {catalog.status === 'loading'
                  ? 'Loading pre-generated prompts…'
                  : 'No pre-generated prompts are available.'}
              </Text>
            </Paper>
          )}
        </section>
      </div>

      <div className={styles.generationColumn}>
        <BrowserGenerationPanel
          createWorker={createWorker}
          crossOriginIsolationWarning={embedded && !isCrossOriginIsolated()}
          fullWidth
          modelSource={modelSource}
          onGenerationStarted={handleGenerationStarted}
          onResultChange={handleResultChange}
          onGenerationActiveChange={setGenerationActive}
        />
      </div>

      {generationStarted && (
        <section className={styles.homepageVisualization} aria-live="polite">
          <header className={styles.generationResultHeader}>
            <div>
              <Text className={shared.eyebrow}>Live attention</Text>
              <Title order={2}>What your prompt generated</Title>
            </div>
            {generationResult && (
              <Text size="sm" c="dimmed">
                {generationResult.manifest.tokens.length -
                  generationResult.manifest.promptTokenCount}{' '}
                generated tokens · summed across{' '}
                {generationResult.manifest.geometry.layers} layers
              </Text>
            )}
          </header>

          {generationResult ? (
            <ContributionText
              manifest={generationResult.manifest}
              contributions={generationResult.contributions}
              showOpacityControls={false}
              playing={customVisualizationPlaying}
              onPlayingChange={setCustomVisualizationPlaying}
              animationSuppressed={generationActive}
            />
          ) : (
            <Paper
              className={shared.textVisualizationState}
              withBorder
              radius="lg"
              p="xl"
            >
              <Text size="sm" c="dimmed">
                Attention will appear when the prompt is ready.
              </Text>
            </Paper>
          )}
        </section>
      )}
    </div>
  );
}
