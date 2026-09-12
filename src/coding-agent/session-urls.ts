import { GENERATED_DATA_BASE_URL } from '../data/dataset-catalog.ts';
import type { SessionIndexEntry } from './session-index.ts';

/**
 * Base URL under which every session lives in its own folder
 * (`<id>/session.json` + `<id>/info.json`), with a generated `index.json`
 * describing them all.
 */
export const SESSIONS_BASE_URL = `${GENERATED_DATA_BASE_URL}coding-agent/`;

export function sessionIndexUrl(): string {
  return `${SESSIONS_BASE_URL}index.json`;
}

export function sessionUrl(entry: Pick<SessionIndexEntry, 'path'>): string {
  return `${SESSIONS_BASE_URL}${entry.path}session.json`;
}
