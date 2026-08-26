import { Alert, Badge, Loader, Paper, Text, Tooltip } from '@mantine/core';
import { useMemo, useState, type CSSProperties } from 'react';

import type { ContributionDataSource } from '../data/contribution-data-source.ts';
import { useContributionData } from '../data/use-contribution-data.ts';
import type { ContributionManifest } from '../generation/types.ts';
import {
  contributionPath,
  displayToken,
  LAYER_LABEL_WIDTH,
  LAYER_ROW_HEIGHT,
  nodeCenter,
  rankContributions,
  TOKEN_COLUMN_WIDTH,
  TOKEN_HEADER_HEIGHT,
} from './contributions.ts';

type Selection = {
  layer: number;
  token: number;
};

type ContributionGridProps = {
  source: ContributionDataSource;
};

function sameSelection(left: Selection | null, right: Selection) {
  return left?.layer === right.layer && left.token === right.token;
}

function SelectionDetails({
  manifest,
  selection,
  row,
  loading,
  error,
}: {
  manifest: ContributionManifest;
  selection: Selection | null;
  row?: number[];
  loading: boolean;
  error?: Error;
}) {
  if (!selection) {
    return (
      <Paper className="selection-panel" withBorder radius="md" p="md">
        <Text fw={600}>Inspect a node</Text>
        <Text size="sm" c="dimmed">
          Hover to preview contributions, or click a node to pin it.
        </Text>
      </Paper>
    );
  }

  const token = manifest.tokens[selection.token];
  const ranked = row ? rankContributions(row, selection.token) : [];
  const selfContribution = row?.[selection.token];

  return (
    <Paper className="selection-panel" withBorder radius="md" p="md">
      <div className="selection-heading">
        <div>
          <Text fw={650}>{displayToken(token.text)}</Text>
          <Text size="xs" c="dimmed">
            Token {selection.token} · ID {token.id} · Layer {selection.layer}
          </Text>
        </div>
        <Badge variant="light">
          {selection.token < manifest.promptTokenCount ? 'Prompt' : 'Generated'}
        </Badge>
      </div>

      {loading && (
        <div className="selection-loading">
          <Loader size="xs" />
          <Text size="sm" c="dimmed">
            Loading layer {selection.layer}
          </Text>
        </div>
      )}
      {error && (
        <Alert color="red" mt="sm" title="Layer could not be loaded">
          {error.message}
        </Alert>
      )}
      {row && (
        <div className="contribution-summary">
          <div className="self-contribution">
            <Text size="xs" c="dimmed">
              Self contribution
            </Text>
            <Text ff="monospace" size="sm">
              {selfContribution?.toPrecision(5) ?? '0'}
            </Text>
          </div>
          <div className="ranked-contributions">
            {ranked.map((contribution) => (
              <div className="ranked-contribution" key={contribution.source}>
                <Text size="xs" className="ranked-token">
                  {displayToken(manifest.tokens[contribution.source].text)}
                </Text>
                <div className="ranked-bar-track" aria-hidden="true">
                  <div
                    className="ranked-bar"
                    style={{ width: `${contribution.strength * 100}%` }}
                  />
                </div>
                <Text ff="monospace" size="xs">
                  {contribution.value.toPrecision(4)}
                </Text>
              </div>
            ))}
          </div>
        </div>
      )}
    </Paper>
  );
}

function LoadedGrid({
  source,
  manifest,
}: {
  source: ContributionDataSource;
  manifest: ContributionManifest;
}) {
  const { layers, layerErrors, loadLayer } = useContributionData(
    source,
    manifest,
  );
  const [hovered, setHovered] = useState<Selection | null>(null);
  const [pinned, setPinned] = useState<Selection | null>(null);
  const selection = pinned ?? hovered;
  const selectedLayer =
    selection === null ? undefined : layers.get(selection.layer);
  const selectedRow =
    selection === null ? undefined : selectedLayer?.rows[selection.token];
  const edges = useMemo(
    () =>
      selection && selectedRow
        ? rankContributions(selectedRow, selection.token)
        : [],
    [selectedRow, selection],
  );
  const sourceTokens = useMemo(
    () => new Set(edges.map((edge) => edge.source)),
    [edges],
  );
  const width = LAYER_LABEL_WIDTH + manifest.tokens.length * TOKEN_COLUMN_WIDTH;
  const height =
    TOKEN_HEADER_HEIGHT + manifest.geometry.layers * LAYER_ROW_HEIGHT;

  const inspect = (next: Selection) => {
    setHovered(next);
    void loadLayer(next.layer).catch(() => undefined);
  };

  const togglePin = (next: Selection) => {
    setPinned((current) => (sameSelection(current, next) ? null : next));
    void loadLayer(next.layer).catch(() => undefined);
  };

  return (
    <>
      <Paper className="grid-frame" withBorder radius="lg">
        <div className="grid-scroll" tabIndex={0}>
          <div
            className="contribution-grid"
            role="grid"
            aria-label="Token contributions by transformer layer"
            style={{
              width,
              height,
              gridTemplateColumns: `${LAYER_LABEL_WIDTH}px repeat(${manifest.tokens.length}, ${TOKEN_COLUMN_WIDTH}px)`,
              gridTemplateRows: `${TOKEN_HEADER_HEIGHT}px repeat(${manifest.geometry.layers}, ${LAYER_ROW_HEIGHT}px)`,
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setPinned(null);
                setHovered(null);
              }
            }}
          >
            <div className="grid-corner">Layer</div>
            {manifest.tokens.map((token, tokenIndex) => (
              <Tooltip
                key={`${tokenIndex}-${token.id}`}
                label={`Token ${tokenIndex} · ID ${token.id} · ${JSON.stringify(token.text)}`}
                openDelay={350}
              >
                <div
                  className={`token-heading ${tokenIndex >= manifest.promptTokenCount ? 'generated-token' : ''}`}
                  style={{ gridColumn: tokenIndex + 2, gridRow: 1 }}
                >
                  <span>{displayToken(token.text)}</span>
                  <small>{tokenIndex}</small>
                </div>
              </Tooltip>
            ))}

            {Array.from({ length: manifest.geometry.layers }, (_, layer) => (
              <div key={`row-${layer}`} className="layer-row-contents">
                <div
                  className="layer-track"
                  style={{ gridColumn: '2 / -1', gridRow: layer + 2 }}
                />
                <div
                  className="layer-label"
                  style={{ gridColumn: 1, gridRow: layer + 2 }}
                >
                  {layer}
                </div>
              </div>
            ))}

            {Array.from({ length: manifest.geometry.layers }, (_, layer) =>
              manifest.tokens.map((token, tokenIndex) => {
                const node = { layer, token: tokenIndex };
                const active = selection && sameSelection(selection, node);
                const sourceActive =
                  selection?.layer === layer && sourceTokens.has(tokenIndex);
                const selfValue =
                  active && selectedRow ? selectedRow[tokenIndex] : undefined;
                return (
                  <button
                    type="button"
                    role="gridcell"
                    key={`${layer}-${tokenIndex}`}
                    className={`token-node ${active ? 'active' : ''} ${sourceActive ? 'source-active' : ''} ${tokenIndex >= manifest.promptTokenCount ? 'generated-node' : ''}`}
                    style={
                      {
                        gridColumn: tokenIndex + 2,
                        gridRow: layer + 2,
                        '--self-strength': selfValue
                          ? Math.min(1, selfValue / 10)
                          : 0,
                      } as CSSProperties
                    }
                    aria-label={`Layer ${layer}, token ${tokenIndex}, ${JSON.stringify(token.text)}`}
                    aria-pressed={Boolean(active && pinned)}
                    onMouseEnter={() => inspect(node)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => inspect(node)}
                    onBlur={() => setHovered(null)}
                    onClick={() => togglePin(node)}
                  >
                    <span />
                  </button>
                );
              }),
            )}

            <div
              className="generation-boundary"
              aria-hidden="true"
              style={{
                left:
                  LAYER_LABEL_WIDTH +
                  manifest.promptTokenCount * TOKEN_COLUMN_WIDTH,
                top: TOKEN_HEADER_HEIGHT,
              }}
            />

            <svg
              className="contribution-overlay"
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="contribution-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
              </defs>
              {selection &&
                edges.map((edge) => (
                  <path
                    key={edge.source}
                    className="contribution-arrow"
                    d={contributionPath(
                      selection.layer,
                      edge.source,
                      selection.token,
                    )}
                    style={{
                      strokeWidth: 1 + edge.strength * 5,
                      opacity: 0.28 + edge.strength * 0.72,
                    }}
                    markerEnd="url(#contribution-arrow)"
                  />
                ))}
              {selection && selectedRow && (
                <circle
                  className="self-contribution-ring"
                  {...nodeCenter(selection.layer, selection.token)}
                  r={18}
                />
              )}
            </svg>
          </div>
        </div>
      </Paper>

      <SelectionDetails
        manifest={manifest}
        selection={selection}
        row={selectedRow}
        loading={Boolean(
          selection && !selectedLayer && !layerErrors.has(selection.layer),
        )}
        error={selection ? layerErrors.get(selection.layer) : undefined}
      />
    </>
  );
}

function ContributionGridSession({ source }: ContributionGridProps) {
  const { manifestState } = useContributionData(source);

  if (manifestState.status === 'loading') {
    return (
      <div className="page-state">
        <Loader />
        <Text c="dimmed">Loading contribution manifest</Text>
      </div>
    );
  }
  if (manifestState.status === 'error') {
    return (
      <Alert color="red" title="Contribution data could not be loaded">
        {manifestState.error.message}
      </Alert>
    );
  }

  return <LoadedGrid source={source} manifest={manifestState.manifest} />;
}

export function ContributionGrid({ source }: ContributionGridProps) {
  return <ContributionGridSession key={source.id} source={source} />;
}
