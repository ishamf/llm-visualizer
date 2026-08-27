import { Alert, Loader, NumberInput, Paper, Select, Text } from '@mantine/core';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { SummedContributionDataSource } from '../data/summed-contribution-data-source.ts';
import type { ContributionManifest } from '../generation/types.ts';
import type { SummedContributions } from '../generation/types.ts';
import {
  contributionOpacity,
  type ContributionOpacityScale,
  MINIMUM_TOKEN_OPACITY,
  nearestTokenIndex,
  predictionContributionRow,
  type TokenRectangle,
} from './text-contributions.ts';

type AggregateState =
  | { status: 'loading' }
  | { status: 'ready'; contributions: SummedContributions }
  | { status: 'error'; error: Error };

type ContributionTextProps = {
  manifest: ContributionManifest;
} & (
  | { source: SummedContributionDataSource; contributions?: never }
  | { source?: never; contributions: SummedContributions }
);

export function ContributionText(props: ContributionTextProps) {
  const { manifest } = props;
  const source = 'source' in props ? props.source : undefined;
  const contributions =
    'contributions' in props ? props.contributions : undefined;
  const [sourceAggregate, setSourceAggregate] = useState<AggregateState>({
    status: 'loading',
  });
  const aggregate: AggregateState = contributions
    ? { status: 'ready', contributions }
    : sourceAggregate;
  const [pointerToken, setPointerToken] = useState<number | null>(null);
  const [focusedToken, setFocusedToken] = useState<number | null>(null);
  const [opacityScale, setOpacityScale] =
    useState<ContributionOpacityScale>('linear');
  const [minimumOpacity, setMinimumOpacity] = useState(MINIMUM_TOKEN_OPACITY);
  const contributionText = useRef<HTMLDivElement>(null);
  const tokenElements = useRef<Array<HTMLSpanElement | null>>([]);
  const tokenRectangles = useRef<
    ReadonlyArray<ReadonlyArray<TokenRectangle>> | undefined
  >(undefined);

  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    const load = async () => {
      const contributions = await source.getContributions(controller.signal);
      if (!controller.signal.aborted) {
        setSourceAggregate({
          status: 'ready',
          contributions,
        });
      }
    };

    void load().catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setSourceAggregate({
          status: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    });
    return () => controller.abort();
  }, [source]);

  useEffect(() => {
    const container = contributionText.current;
    if (!container) return;

    const invalidateRectangles = () => {
      tokenRectangles.current = undefined;
    };
    const observer = new ResizeObserver(invalidateRectangles);
    observer.observe(container);
    window.addEventListener('scroll', invalidateRectangles, true);

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', invalidateRectangles, true);
    };
  }, [aggregate.status, manifest.tokens]);

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

  const activeToken = focusedToken ?? pointerToken;
  const row =
    activeToken === null
      ? undefined
      : predictionContributionRow(
          aggregate.contributions.rows,
          activeToken,
          aggregate.contributions.targetTokenStart,
        );

  const measureTokenRectangles = () => {
    const rectangles = manifest.tokens.map((_, index) =>
      tokenElements.current[index]
        ? Array.from(tokenElements.current[index].getClientRects())
        : [],
    );
    tokenRectangles.current = rectangles;
    return rectangles;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    const rectangles = tokenRectangles.current ?? measureTokenRectangles();
    setPointerToken(
      nearestTokenIndex(event.clientX, event.clientY, rectangles),
    );
  };

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
        ref={contributionText}
        className="contribution-text"
        aria-label="Prompt and generated text by token"
        onPointerEnter={() => {
          tokenRectangles.current = undefined;
        }}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setPointerToken(null)}
      >
        {manifest.tokens.map((token, index) => {
          const active = activeToken === index;
          const opacity =
            activeToken === null || row === undefined || active
              ? 1
              : contributionOpacity(row, index, minimumOpacity, opacityScale);
          const generated = index >= manifest.promptTokenCount;
          return (
            <span
              ref={(element) => {
                tokenElements.current[index] = element;
              }}
              key={`${index}-${token.id}`}
              className={`contribution-text-token ${active ? 'active-contribution-text-token' : ''} ${generated ? 'generated-text-token' : 'prompt-text-token'} ${index === manifest.promptTokenCount ? 'generation-start-token' : ''}`}
              style={{ '--token-opacity': opacity } as CSSProperties}
              tabIndex={0}
              aria-label={`Token ${index}, ID ${token.id}, ${JSON.stringify(token.text)}`}
              onFocus={() => setFocusedToken(index)}
              onBlur={() => setFocusedToken(null)}
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
          {activeToken === null
            ? 'Hover or focus a token to reveal its sources.'
            : activeToken < manifest.promptTokenCount
              ? 'Prompt-token contribution rows are not stored for this view.'
              : `Token ${activeToken} uses contributions at position ${activeToken - 1}, summed across all layers.`}
        </Text>
      </div>
    </Paper>
  );
}
