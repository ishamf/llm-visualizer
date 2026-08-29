import {
  ActionIcon,
  Alert,
  Loader,
  NumberInput,
  Paper,
  Progress,
  Select,
  Text,
  useComputedColorScheme,
} from '@mantine/core';
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
import { usePortalTarget } from '../web-component/portal-target-context.ts';
import {
  contributionOpacity,
  type ContributionOpacityScale,
  LIGHT_MINIMUM_TOKEN_OPACITY,
  LIGHT_OPACITY_KNEE,
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
  showOpacityControls?: boolean;
  playing?: boolean;
  onPlayingChange?: (playing: boolean) => void;
  animationSuppressed?: boolean;
} & (
  | { source: SummedContributionDataSource; contributions?: never }
  | { source?: never; contributions: SummedContributions }
);

export function ContributionText(props: ContributionTextProps) {
  const portalTarget = usePortalTarget();
  const colorScheme = useComputedColorScheme('light');
  const { manifest } = props;
  const source = 'source' in props ? props.source : undefined;
  const contributions =
    'contributions' in props ? props.contributions : undefined;
  const showOpacityControls = props.showOpacityControls ?? true;
  const [uncontrolledPlaying, setUncontrolledPlaying] = useState(true);
  const playing = props.playing ?? uncontrolledPlaying;
  const animationSuppressed = props.animationSuppressed ?? false;
  const [sourceAggregate, setSourceAggregate] = useState<AggregateState>({
    status: 'loading',
  });
  const aggregate: AggregateState = contributions
    ? { status: 'ready', contributions }
    : sourceAggregate;
  const [pointerToken, setPointerToken] = useState<number | null>(null);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusedToken, setFocusedToken] = useState<number | null>(null);
  const [animatedTokenPosition, setAnimatedTokenPosition] = useState(0);
  const [opacityScale, setOpacityScale] =
    useState<ContributionOpacityScale>('linear');
  const [minimumOpacityOverride, setMinimumOpacityOverride] = useState<
    number | undefined
  >();
  const defaultMinimumOpacity =
    colorScheme === 'light'
      ? LIGHT_MINIMUM_TOKEN_OPACITY
      : MINIMUM_TOKEN_OPACITY;
  const minimumOpacity = minimumOpacityOverride ?? defaultMinimumOpacity;
  const opacityKnee =
    colorScheme === 'light' && minimumOpacityOverride === undefined
      ? LIGHT_OPACITY_KNEE
      : undefined;
  const contributionText = useRef<HTMLDivElement>(null);
  const tokenElements = useRef<Array<HTMLSpanElement | null>>([]);
  const tokenRectangles = useRef<
    ReadonlyArray<ReadonlyArray<TokenRectangle>> | undefined
  >(undefined);
  const generatedTokenCount = Math.max(
    0,
    manifest.tokens.length - manifest.promptTokenCount,
  );
  const animationReady = aggregate.status === 'ready';

  const setPlaying = (nextPlaying: boolean) => {
    setAnimatedTokenPosition(0);
    if (props.playing === undefined) setUncontrolledPlaying(nextPlaying);
    props.onPlayingChange?.(nextPlaying);
  };

  useEffect(() => {
    if (
      !playing ||
      animationSuppressed ||
      !animationReady ||
      generatedTokenCount === 0 ||
      focusedToken !== null
    ) {
      return;
    }
    if (pointerInside) return;

    let frame: number;
    let previousTime: number | undefined;
    const animate = (time: number) => {
      if (previousTime !== undefined) {
        const elapsedSeconds = Math.min((time - previousTime) / 1000, 0.1);
        setAnimatedTokenPosition(
          (current) => (current + elapsedSeconds * 3) % generatedTokenCount,
        );
      }
      previousTime = time;
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [
    animationReady,
    animationSuppressed,
    generatedTokenCount,
    focusedToken,
    playing,
    pointerInside,
  ]);

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

  const animationVisible =
    playing &&
    !animationSuppressed &&
    animationReady &&
    !pointerInside &&
    focusedToken === null &&
    generatedTokenCount > 0;
  const animatedTokenOffset = Math.floor(animatedTokenPosition);
  const nextAnimatedTokenOffset =
    generatedTokenCount > 0
      ? (animatedTokenOffset + 1) % generatedTokenCount
      : 0;
  const animationMix = animatedTokenPosition - animatedTokenOffset;
  const animatedToken = manifest.promptTokenCount + animatedTokenOffset;
  const nextAnimatedToken = manifest.promptTokenCount + nextAnimatedTokenOffset;
  const interactionToken = focusedToken ?? pointerToken;
  const activeToken =
    interactionToken ??
    (animationVisible
      ? animationMix < 0.5
        ? animatedToken
        : nextAnimatedToken
      : null);
  const row =
    activeToken === null
      ? undefined
      : predictionContributionRow(
          aggregate.contributions.rows,
          activeToken,
          aggregate.contributions.targetTokenStart,
        );
  const currentAnimationRow = animationVisible
    ? predictionContributionRow(
        aggregate.contributions.rows,
        animatedToken,
        aggregate.contributions.targetTokenStart,
      )
    : undefined;
  const nextAnimationRow = animationVisible
    ? predictionContributionRow(
        aggregate.contributions.rows,
        nextAnimatedToken,
        aggregate.contributions.targetTokenStart,
      )
    : undefined;
  const rowMaximum = row ? Math.max(...row) : undefined;
  const currentAnimationMaximum = currentAnimationRow
    ? Math.max(...currentAnimationRow)
    : undefined;
  const nextAnimationMaximum = nextAnimationRow
    ? Math.max(...nextAnimationRow)
    : undefined;

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
      {showOpacityControls && (
        <div className="text-visualization-controls">
          <Select
            comboboxProps={{ portalProps: { target: portalTarget } }}
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
              setMinimumOpacityOverride(
                typeof value === 'number'
                  ? Math.min(0.9, Math.max(0, value))
                  : 0,
              )
            }
            min={0}
            max={0.9}
            step={0.05}
            decimalScale={2}
          />
        </div>
      )}

      <div
        ref={contributionText}
        className={`contribution-text ${animationVisible ? 'animating-contribution-text' : ''}`}
        aria-label="Prompt and generated text by token"
        onPointerEnter={(event) => {
          if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
            return;
          }
          tokenRectangles.current = undefined;
          setPointerInside(true);
        }}
        onPointerMove={handlePointerMove}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
            return;
          }
          setPointerInside(false);
          setPointerToken(null);
        }}
      >
        {manifest.tokens.map((token, index) => {
          const active = interactionToken === index;
          const animatedFocus = animationVisible
            ? (index === animatedToken ? 1 - animationMix : 0) +
              (index === nextAnimatedToken ? animationMix : 0)
            : 0;
          let opacity = 1;
          if (interactionToken !== null && row !== undefined && !active) {
            opacity = contributionOpacity(
              row,
              index,
              minimumOpacity,
              opacityScale,
              opacityKnee,
              rowMaximum,
            );
          } else if (animationVisible) {
            const currentOpacity =
              index === animatedToken || currentAnimationRow === undefined
                ? 1
                : contributionOpacity(
                    currentAnimationRow,
                    index,
                    minimumOpacity,
                    opacityScale,
                    opacityKnee,
                    currentAnimationMaximum,
                  );
            const nextOpacity =
              index === nextAnimatedToken || nextAnimationRow === undefined
                ? 1
                : contributionOpacity(
                    nextAnimationRow,
                    index,
                    minimumOpacity,
                    opacityScale,
                    opacityKnee,
                    nextAnimationMaximum,
                  );
            opacity =
              currentOpacity + (nextOpacity - currentOpacity) * animationMix;
          }
          const generated = index >= manifest.promptTokenCount;
          return (
            <span
              ref={(element) => {
                tokenElements.current[index] = element;
              }}
              key={`${index}-${token.id}`}
              className={`contribution-text-token ${active ? 'active-contribution-text-token' : ''} ${animatedFocus > 0 ? 'animated-contribution-text-token' : ''} ${generated ? 'generated-text-token' : 'prompt-text-token'} ${index === manifest.promptTokenCount ? 'generation-start-token' : ''}`}
              style={
                {
                  '--token-opacity': opacity,
                  '--token-focus-percent': `${animatedFocus * 100}%`,
                } as CSSProperties
              }
              tabIndex={0}
              aria-label={`Token ${index}, ID ${token.id}, ${JSON.stringify(token.text)}`}
              onPointerDown={(event) => {
                if (event.pointerType === 'touch') event.currentTarget.focus();
              }}
              onFocus={() => setFocusedToken(index)}
              onBlur={() => setFocusedToken(null)}
            >
              {token.text}
            </span>
          );
        })}
      </div>

      <div className="text-visualization-playback">
        <ActionIcon
          variant="light"
          size="lg"
          aria-label={
            playing ? 'Pause token animation' : 'Play token animation'
          }
          onClick={() => setPlaying(!playing)}
        >
          <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
        </ActionIcon>
        <Progress
          className="text-visualization-progress"
          value={
            !playing ||
            animationSuppressed ||
            !animationReady ||
            generatedTokenCount === 0
              ? 0
              : (animatedTokenPosition / generatedTokenCount) * 100
          }
          aria-label="Token animation progress"
        />
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
            : interactionToken === null && animationMix > 0
              ? `Blending generated tokens ${animatedToken} and ${nextAnimatedToken}, summed across all layers.`
              : activeToken < manifest.promptTokenCount
                ? 'Prompt-token contribution rows are not stored for this view.'
                : `Token ${activeToken} uses contributions at position ${activeToken - 1}, summed across all layers.`}
        </Text>
      </div>
    </Paper>
  );
}
