export const TOKEN_COLUMN_WIDTH = 76;
export const LAYER_ROW_HEIGHT = 84;
export const TOKEN_HEADER_HEIGHT = 92;
export const LAYER_LABEL_WIDTH = 72;

export type RankedContribution = {
  source: number;
  value: number;
  strength: number;
};

export function rankContributions(
  row: number[],
  destination: number,
  limit = 8,
  relativeThreshold = 0.025,
): RankedContribution[] {
  const ranked = row
    .map((value, source) => ({ source, value }))
    .filter(({ source, value }) => source !== destination && value > 0)
    .sort((left, right) => right.value - left.value);
  const maximum = ranked[0]?.value ?? 0;
  if (maximum === 0) return [];

  return ranked
    .filter(({ value }) => value / maximum >= relativeThreshold)
    .slice(0, limit)
    .map(({ source, value }) => ({
      source,
      value,
      strength: Math.sqrt(value / maximum),
    }));
}

export function nodeCenter(layer: number, token: number) {
  return {
    x: LAYER_LABEL_WIDTH + token * TOKEN_COLUMN_WIDTH + TOKEN_COLUMN_WIDTH / 2,
    y: TOKEN_HEADER_HEIGHT + layer * LAYER_ROW_HEIGHT + LAYER_ROW_HEIGHT / 2,
  };
}

export function contributionPath(
  layer: number,
  source: number,
  destination: number,
) {
  const start = nodeCenter(layer, source);
  const end = nodeCenter(layer, destination);
  const distance = Math.abs(destination - source);
  const lift = Math.min(30, 11 + distance * 2.2);
  return `M ${start.x} ${start.y} C ${start.x} ${start.y - lift}, ${end.x} ${end.y - lift}, ${end.x} ${end.y}`;
}

export function displayToken(text: string) {
  if (text.length === 0) return '∅';
  return text.replaceAll(' ', '·').replaceAll('\n', '↵').replaceAll('\t', '⇥');
}
