import { describe, expect, it, vi } from 'vitest';

import { createSeekThrottle } from './seek-throttle.ts';

const WINDOW_MS = 250;

/**
 * Deterministic harness: an injectable clock (vitest fake timers do not mock
 * `performance.now`, which is the controller's default) plus the recorded
 * render times. `setAt` mirrors the real flow, where the authoritative time
 * (`timeRef`) is updated before the throttle is asked to render it.
 */
function makeThrottle() {
  const clock = { now: 1000 };
  const renders: number[] = [];
  let authoritative = 0;
  const throttle = createSeekThrottle({
    windowMs: WINDOW_MS,
    render: (time) => renders.push(time),
    getTime: () => authoritative,
    now: () => clock.now,
  });
  const setAt = (time: number) => {
    authoritative = time;
  };
  const advance = (ms: number) => {
    clock.now += ms;
    vi.advanceTimersByTime(ms);
  };
  return {
    seek: throttle.seek,
    dispose: throttle.dispose,
    renders,
    setAt,
    advance,
  };
}

describe('createSeekThrottle', () => {
  it('renders the first seek immediately (leading update)', () => {
    vi.useFakeTimers();
    const throttle = makeThrottle();
    throttle.setAt(5);
    throttle.seek(5);
    expect(throttle.renders).toEqual([5]);
    vi.useRealTimers();
  });

  it('defers seeks inside the window to a single trailing update', () => {
    vi.useFakeTimers();
    const throttle = makeThrottle();
    throttle.setAt(5);
    throttle.seek(5);
    throttle.advance(100);
    throttle.setAt(10);
    throttle.seek(10);
    expect(throttle.renders).toEqual([5]);
    // Trailing fires 250ms after the leading render, not after the last call.
    throttle.advance(150);
    expect(throttle.renders).toEqual([5, 10]);
    vi.useRealTimers();
  });

  it('renders a fast scrub as leading + one trailing update', () => {
    vi.useFakeTimers();
    const throttle = makeThrottle();
    throttle.setAt(1);
    throttle.seek(1);
    for (let value = 2; value <= 10; value += 1) {
      throttle.advance(20);
      throttle.setAt(value);
      throttle.seek(value);
    }
    expect(throttle.renders).toEqual([1]);
    throttle.advance(100);
    expect(throttle.renders).toEqual([1, 10]);
    vi.useRealTimers();
  });

  it('renders immediately again after the window has passed', () => {
    vi.useFakeTimers();
    const throttle = makeThrottle();
    throttle.setAt(1);
    throttle.seek(1);
    throttle.advance(WINDOW_MS);
    throttle.setAt(2);
    throttle.seek(2);
    expect(throttle.renders).toEqual([1, 2]);
    // No trailing update is left pending after a leading render.
    throttle.advance(WINDOW_MS * 2);
    expect(throttle.renders).toEqual([1, 2]);
    vi.useRealTimers();
  });

  it('renders the authoritative time on the trailing update', () => {
    vi.useFakeTimers();
    const throttle = makeThrottle();
    throttle.setAt(1);
    throttle.seek(1);
    throttle.advance(100);
    throttle.setAt(2);
    throttle.seek(2);
    // Simulates the animation loop advancing past the last seek before the
    // trailing update fires.
    throttle.setAt(9);
    throttle.advance(150);
    expect(throttle.renders).toEqual([1, 9]);
    vi.useRealTimers();
  });

  it('renders immediately on demand and cancels the pending trailing update', () => {
    vi.useFakeTimers();
    const throttle = makeThrottle();
    throttle.setAt(1);
    throttle.seek(1);
    throttle.advance(100);
    throttle.setAt(2);
    throttle.seek(2);
    throttle.advance(100);
    throttle.setAt(3);
    throttle.seek(3, { immediate: true });
    expect(throttle.renders).toEqual([1, 3]);
    throttle.advance(WINDOW_MS * 2);
    expect(throttle.renders).toEqual([1, 3]);
    vi.useRealTimers();
  });

  it('dispose cancels a pending trailing update', () => {
    vi.useFakeTimers();
    const throttle = makeThrottle();
    throttle.setAt(1);
    throttle.seek(1);
    throttle.advance(100);
    throttle.setAt(2);
    throttle.seek(2);
    throttle.dispose();
    throttle.advance(WINDOW_MS * 2);
    expect(throttle.renders).toEqual([1]);
    vi.useRealTimers();
  });
});
