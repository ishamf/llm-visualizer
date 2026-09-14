import type { UsageBreakdown } from './timeline.ts';

/** Usage categories in display order, shared by the desktop request list
 * footer and the mobile summary card's breakdown view. */
export const FOOTER_CATEGORY_ROWS: Array<[string, keyof UsageBreakdown]> = [
  ['Cached', 'cached'],
  ['Cache write', 'cacheWrite'],
  ['Input', 'input'],
  ['Output', 'output'],
];
