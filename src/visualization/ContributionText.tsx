import { Alert, Loader, NumberInput, Paper, Select, Text } from '@mantine/core';
import { useEffect, useState, type CSSProperties } from 'react';

import type { SummedContributionDataSource } from '../data/summed-contribution-data-source.ts';
import type { ContributionManifest } from '../generation/types.ts';
import {
  contributionOpacity,
  type ContributionOpacityScale,
  MINIMUM_TOKEN_OPACITY,
  predictionContributionRow,
} from './text-contributions.ts';

type AggregateState =
  | { status: 'loading' }
  | { status: 'ready'; totals: number[][] }
  | { status: 'error'; error: Error };

type ContributionTextProps = {
  source: SummedContributionDataSource;
  manifest: ContributionManifest;
};

export function ContributionText({ source, manifest }: ContributionTextProps) {
  const [aggregate, setAggregate] = useState<AggregateState>({
    status: 'loading',
  });
  const [hoveredToken, setHoveredToken] = useState<number | null>(null);
  const [opacityScale, setOpacityScale] =
    useState<ContributionOpacityScale>('linear');
  const [minimumOpacity, setMinimumOpacity] = useState(MINIMUM_TOKEN_OPACITY);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      const contributions = await source.getContributions(controller.signal);
      if (!controller.signal.aborted) {
        setAggregate({
          status: 'ready',
          totals: contributions.rows,
        });
      }
    };

    void load().catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setAggregate({
          status: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    });
    return () => controller.abort();
  }, [manifest, source]);

  if (aggregate.status === 'loading') {
    return (
      <Paper className="text-visualization-state" withBorder radius="lg" p="xl">
        <Loader size="sm" />
        <Text size="sm" c="dimmed">
          Loading contributions summed across {manifest.geometry.layers} layers…
        </Text>
      </Paper>
    );
  }

  if (aggregate.status === 'error') {
    return (
      <Alert color="red" title="Contribution data could not be loaded">
        {aggregate.error.message}
      </Alert>
    );
  }

  const row =
    hoveredToken === null
      ? undefined
      : predictionContributionRow(aggregate.totals, hoveredToken);

  return (
    <Paper className="text-visualization" withBorder radius="lg" p="xl">
      <div className="text-visualization-controls">
        <Select
          label="Opacity scale"
          description="How contribution strength maps to visibility"
          data={[
            { value: 'linear', label: 'Linear' },
            { value: 'logarithmic', label: 'Logarithmic' },
          ]}
          value={opacityScale}
          onChange={(value) =>
            setOpacityScale(
              (value as ContributionOpacityScale | null) ?? 'linear',
            )
          }
          allowDeselect={false}
        />
        <NumberInput
          label="Minimum opacity"
          description="Visibility of tokens with no contribution"
          value={minimumOpacity}
          onChange={(value) =>
            setMinimumOpacity(
              typeof value === 'number' ? Math.min(0.9, Math.max(0, value)) : 0,
            )
          }
          min={0}
          max={0.9}
          step={0.05}
          decimalScale={2}
        />
      </div>

      <div
        className="contribution-text"
        aria-label="Prompt and generated text by token"
        onMouseLeave={() => setHoveredToken(null)}
      >
        {manifest.tokens.map((token, index) => {
          const active = hoveredToken === index;
          const opacity =
            hoveredToken === null || row === undefined || active
              ? 1
              : contributionOpacity(row, index, minimumOpacity, opacityScale);
          const generated = index >= manifest.promptTokenCount;
          return (
            <span
              key={`${index}-${token.id}`}
              className={`contribution-text-token ${generated ? 'generated-text-token' : 'prompt-text-token'} ${index === manifest.promptTokenCount ? 'generation-start-token' : ''}`}
              style={{ '--token-opacity': opacity } as CSSProperties}
              tabIndex={0}
              aria-label={`Token ${index}, ID ${token.id}, ${JSON.stringify(token.text)}`}
              onMouseEnter={() => setHoveredToken(index)}
              onFocus={() => setHoveredToken(index)}
              onBlur={() => setHoveredToken(null)}
            >
              {token.text}
            </span>
          );
        })}
      </div>

      <div className="text-visualization-legend">
        <span className="legend-swatch prompt-swatch" />
        <Text size="xs" c="dimmed">
          Prompt
        </Text>
        <span className="legend-swatch generated-swatch" />
        <Text size="xs" c="dimmed">
          Generated
        </Text>
        <Text size="xs" c="dimmed" className="hovered-token-detail">
          {hoveredToken === null
            ? 'Hover or focus a token to reveal its sources.'
            : hoveredToken === 0
              ? 'The first token has no preceding prediction position.'
              : `Token ${hoveredToken} uses contributions at position ${hoveredToken - 1}, summed across all layers.`}
        </Text>
      </div>
    </Paper>
  );
}
