import { afterEach, describe, expect, it, vi } from 'vitest';

import { isCrossOriginIsolated } from './cross-origin-isolation.ts';

describe('isCrossOriginIsolated', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports isolation when crossOriginIsolated is true', () => {
    vi.stubGlobal('crossOriginIsolated', true);
    expect(isCrossOriginIsolated()).toBe(true);
  });

  it('reports no isolation when crossOriginIsolated is false', () => {
    vi.stubGlobal('crossOriginIsolated', false);
    expect(isCrossOriginIsolated()).toBe(false);
  });

  it('treats a missing crossOriginIsolated property as no isolation', () => {
    vi.stubGlobal('crossOriginIsolated', undefined);
    expect(isCrossOriginIsolated()).toBe(false);
  });
});
