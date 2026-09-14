import { GENERATED_DATA_BASE_URL } from '../data/dataset-catalog.ts';
import type { SessionIndexEntry } from './session-index.ts';

/**
 * Base URL under which every session lives in its own folder
 * (`<id>/session.json` + `<id>/info.json`), with a generated `index.json`
 * describing them all.
 */
export function sessionsBaseUrl(
  generatedDataBaseUrl: string = GENERATED_DATA_BASE_URL,
): string {
  return `${generatedDataBaseUrl}coding-agent/`;
}

export function sessionIndexUrl(
  generatedDataBaseUrl: string = GENERATED_DATA_BASE_URL,
): string {
  return `${sessionsBaseUrl(generatedDataBaseUrl)}index.json`;
}

export function sessionUrl(
  entry: Pick<SessionIndexEntry, 'path'>,
  generatedDataBaseUrl: string = GENERATED_DATA_BASE_URL,
): string {
  return `${sessionsBaseUrl(generatedDataBaseUrl)}${entry.path}session.json`;
}
