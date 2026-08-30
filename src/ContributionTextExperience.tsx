import { Paper, Popover, Text, Title, UnstyledButton } from '@mantine/core';
import { useCallback, useMemo, useState } from 'react';

import {
  BundledSummedContributionDataSource,
  getBundledSummedContributionDatasets,
} from './data/bundled-summed-contribution-data-source.ts';
import { getConfiguredPromptTitle } from './generation/prompts.ts';
import {
  BrowserGenerationPanel,
  type GenerationResult,
} from './pages/GenerationPage.tsx';
import { selectDefaultPromptId } from './pages/homepage-state.ts';
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
  const [generationResult, setGenerationResult] = useState<GenerationResult>();
  const [generationStarted, setGenerationStarted] = useState(false);
  const [generationActive, setGenerationActive] = useState(false);
  const [presetVisualizationPlaying, setPresetVisualizationPlaying] =
    useState(true);
  const [customVisualizationPlaying, setCustomVisualizationPlaying] =
    useState(true);
  const [promptSelectorOpen, setPromptSelectorOpen] = useState(false);
  const selectedDataset = datasets.find(({ id }) => id === datasetId);
  const selectedSource = useMemo(
    () =>
      selectedDataset
        ? new BundledSummedContributionDataSource(selectedDataset.id)
        : undefined,
    [selectedDataset],
  );

  const handleGenerationStarted = useCallback(() => {
    setGenerationStarted(true);
  }, []);
  const handleResultChange = useCallback(
    (result: GenerationResult | undefined) => setGenerationResult(result),
    [],
  );
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
      <div className="experience-primary">
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

        <section className="homepage-visualization" aria-live="polite">
          <header className="generation-result-header">
            <div>
              <Text className="eyebrow">Pre-generated contribution text</Text>
              <Title order={2}>What the model used</Title>
            </div>
            <Text size="sm" c="dimmed">
              {selectedDataset
                ? `${selectedDataset.manifest.model.id} · ${selectedDataset.manifest.geometry.layers} layers`
                : ''}
            </Text>
          </header>

          {selectedDataset && selectedSource ? (
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
                playing={presetVisualizationPlaying}
                onPlayingChange={setPresetVisualizationPlaying}
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
        <BrowserGenerationPanel
          createWorker={createWorker}
          modelBaseUrl={modelBaseUrl}
          onGenerationStarted={handleGenerationStarted}
          onResultChange={handleResultChange}
          onGenerationActiveChange={setGenerationActive}
        />
      </div>

      {generationStarted && (
        <section
          className="homepage-visualization custom-prompt-visualization"
          aria-live="polite"
        >
          <header className="generation-result-header">
            <div>
              <Text className="eyebrow">Live contribution text</Text>
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
              className="text-visualization-state"
              withBorder
              radius="lg"
              p="xl"
            >
              <Text size="sm" c="dimmed">
                The live visualization will appear when the prompt is ready.
              </Text>
            </Paper>
          )}
        </section>
      )}
    </div>
  );
}
