import {
  Button,
  Group,
  Paper,
  Popover,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useCallback, useMemo, useReducer, useState } from 'react';

import {
  BundledSummedContributionDataSource,
  getBundledSummedContributionDatasets,
} from './data/bundled-summed-contribution-data-source.ts';
import { getConfiguredPromptTitle } from './generation/prompts.ts';
import {
  BrowserGenerationPanel,
  type GenerationResult,
} from './pages/GenerationPage.tsx';
import {
  homepageGenerationReducer,
  INITIAL_HOMEPAGE_GENERATION_STATE,
  selectDefaultPromptId,
} from './pages/homepage-state.ts';
import { ContributionText } from './visualization/ContributionText.tsx';

const datasets = getBundledSummedContributionDatasets();

type ContributionTextExperienceProps = {
  createWorker: () => Worker;
  modelBaseUrl: string;
};

export function ContributionTextExperience({
  createWorker,
  modelBaseUrl,
}: ContributionTextExperienceProps) {
  const [datasetId, setDatasetId] = useState(() =>
    selectDefaultPromptId(datasets.map(({ id }) => id)),
  );
  const [generationState, dispatchGeneration] = useReducer(
    homepageGenerationReducer,
    INITIAL_HOMEPAGE_GENERATION_STATE,
  );
  const [generationResult, setGenerationResult] = useState<GenerationResult>();
  const [generationActive, setGenerationActive] = useState(false);
  const [visualizationPlaying, setVisualizationPlaying] = useState(true);
  const [promptSelectorOpen, setPromptSelectorOpen] = useState(false);
  const customGenerationActive = generationState.mode === 'custom';
  const selectedDataset = datasets.find(({ id }) => id === datasetId);
  const selectedSource = useMemo(
    () =>
      selectedDataset
        ? new BundledSummedContributionDataSource(selectedDataset.id)
        : undefined,
    [selectedDataset],
  );

  const handleGenerationStarted = useCallback(() => {
    dispatchGeneration({ type: 'start' });
  }, []);
  const handleResultChange = useCallback(
    (result: GenerationResult | undefined) => setGenerationResult(result),
    [],
  );
  const clearGeneration = () => {
    setGenerationResult(undefined);
    dispatchGeneration({ type: 'clear' });
  };

  const selectDataset = (id: string) => {
    setDatasetId(id);
    setPromptSelectorOpen(false);
  };

  const promptOptions = datasets.map(({ id, manifest }) => {
    const selected = id === datasetId;
    const generatedTokens = manifest.tokens.length - manifest.promptTokenCount;
    return (
      <UnstyledButton
        key={id}
        className={`prompt-option ${selected ? 'selected-prompt-option' : ''}`}
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
    <div className="contribution-text-experience">
      <div
        className={`experience-primary ${customGenerationActive ? 'custom-generation-active' : ''}`}
      >
        {!customGenerationActive && (
          <section
            className="prompt-picker"
            aria-labelledby="prompt-picker-title"
          >
            <div>
              <Text className="eyebrow">Pre-generated examples</Text>
              <Title order={2} id="prompt-picker-title">
                Pick a prompt
              </Title>
              <Text c="dimmed" size="sm">
                These examples are ready immediately.
              </Text>
            </div>
            <div className="prompt-list" role="list">
              {promptOptions}
            </div>
          </section>
        )}

        <section className="homepage-visualization" aria-live="polite">
          <header className="generation-result-header">
            <div>
              <Text className="eyebrow">
                {customGenerationActive
                  ? 'Live contribution text'
                  : 'Pre-generated contribution text'}
              </Text>
              <Title order={2}>What the model used</Title>
            </div>
            <Text size="sm" c="dimmed">
              {generationResult && customGenerationActive
                ? `${generationResult.manifest.tokens.length - generationResult.manifest.promptTokenCount} generated tokens · summed across ${generationResult.manifest.geometry.layers} layers`
                : selectedDataset
                  ? `${selectedDataset.manifest.model.id} · ${selectedDataset.manifest.geometry.layers} layers`
                  : ''}
            </Text>
          </header>

          {customGenerationActive ? (
            generationResult ? (
              <ContributionText
                manifest={generationResult.manifest}
                contributions={generationResult.contributions}
                showOpacityControls={false}
                playing={visualizationPlaying}
                onPlayingChange={setVisualizationPlaying}
                animationSuppressed={generationActive}
              />
            ) : (
              <Paper
                className="text-visualization-state"
                withBorder
                radius="lg"
                p="xl"
              >
                <Text size="sm" c="dimmed">
                  The live visualization will appear when the prompt is ready.
                </Text>
              </Paper>
            )
          ) : selectedDataset && selectedSource ? (
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
                    className="dataset-note mobile-prompt-selector"
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
                  className="mobile-prompt-popover"
                  role="dialog"
                  aria-label="Choose a pre-generated prompt"
                >
                  <div className="prompt-list" role="list">
                    {promptOptions}
                  </div>
                </Popover.Dropdown>
              </Popover>
              <ContributionText
                key={selectedDataset.id}
                source={selectedSource}
                manifest={selectedDataset.manifest}
                showOpacityControls={false}
                playing={visualizationPlaying}
                onPlayingChange={setVisualizationPlaying}
              />
            </>
          ) : (
            <Paper
              className="text-visualization-state"
              withBorder
              radius="lg"
              p="xl"
            >
              <Text size="sm" c="dimmed">
                No pre-generated prompts are available in this build.
              </Text>
            </Paper>
          )}
        </section>
      </div>

      <div className="generation-column">
        {customGenerationActive && (
          <Paper
            className="clear-generation-note"
            withBorder
            radius="md"
            p="md"
          >
            <Group
              className="clear-generation-content"
              justify="space-between"
              align="center"
              gap="md"
            >
              <Text size="sm">
                Your generated contribution data is active. Clearing it will
                discard this run.
              </Text>
              <Button color="red" variant="light" onClick={clearGeneration}>
                Clear and use a pre-generated prompt
              </Button>
            </Group>
          </Paper>
        )}
        <BrowserGenerationPanel
          key={generationState.session}
          createWorker={createWorker}
          modelBaseUrl={modelBaseUrl}
          onGenerationStarted={handleGenerationStarted}
          onResultChange={handleResultChange}
          onGenerationActiveChange={setGenerationActive}
        />
      </div>
    </div>
  );
}
