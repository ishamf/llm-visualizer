import { useMediaQuery } from '@mantine/hooks';

/**
 * Media query for hover capability of the user's primary input: a mouse
 * or other hover-capable pointer matches, phones and tablets don't. The
 * browser re-evaluates it live when the input situation changes — a
 * stylus coming out, a keyboard attaching, a convertible flipping modes —
 * and Mantine's hook re-renders on that `change` event.
 */
export const HOVER_QUERY = '(hover: hover)';

/**
 * Whether the user's primary input can hover. Used to pick the charts'
 * pointer behavior (see `CostChartParts.tsx`): hover-capable environments
 * jump on chart click; no-hover environments pin the tooltip on tap and
 * jump through its "Go to" button. `getInitialValueInEffect: false` reads
 * the query synchronously on first render — this is a client-only app, so
 * the first paint should already know the pointer environment instead of
 * flashing the touch variant on desktop. Environments without `matchMedia`
 * (jsdom, workers) land on `false` — the safe default.
 */
export function useCanHover(): boolean {
  return useMediaQuery(HOVER_QUERY, undefined, {
    getInitialValueInEffect: false,
  });
}
