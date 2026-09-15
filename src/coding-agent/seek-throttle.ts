/**
 * Render throttle for seek input. While the user drags the seek bar, the
 * slider fires changes at pointer/rAF rate (60+ per second); each one
 * triggers a full replay re-render (`entriesAt` plus the whole tree), which
 * is far more than the eye needs and stutters the page. This controller
 * renders at most once per `windowMs`: immediately on the first call
 * (leading), then at most once per window, always ending with a trailing
 * update — so the final position is never lost.
 *
 * The authoritative playback time itself is not throttled; the caller keeps
 * it exact and exposes it via `getTime` for the trailing render.
 */
export type SeekThrottleOptions = {
  /** Bypass the throttle: render `value` right away (e.g. scrub release). */
  immediate?: boolean;
};

export type SeekThrottle = {
  seek: (value: number, options?: SeekThrottleOptions) => void;
  /** Cancel a pending trailing update; call on unmount. */
  dispose: () => void;
};

export function createSeekThrottle({
  windowMs,
  render,
  getTime,
  now = () => performance.now(),
}: {
  /** Minimum interval between two rendered updates. */
  windowMs: number;
  /** Re-render callback; receives the time to display. */
  render: (time: number) => void;
  /** Authoritative playback time, read when the trailing update fires. */
  getTime: () => number;
  /** Injectable clock for tests. */
  now?: () => number;
}): SeekThrottle {
  let lastRenderAt = Number.NEGATIVE_INFINITY;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    seek(value, { immediate = false }: SeekThrottleOptions = {}) {
      // A fresh render supersedes any scheduled trailing update — on the
      // leading path it is newer, and on the immediate path it is exact.
      if (trailingTimer !== null) {
        clearTimeout(trailingTimer);
        trailingTimer = null;
      }
      if (immediate) {
        lastRenderAt = now();
        render(value);
        return;
      }
      const elapsed = now() - lastRenderAt;
      if (elapsed >= windowMs) {
        lastRenderAt = now();
        render(value);
        return;
      }
      if (trailingTimer === null) {
        trailingTimer = setTimeout(() => {
          trailingTimer = null;
          lastRenderAt = now();
          // The authoritative time, not a stale scheduled value: while
          // playing, the animation loop keeps advancing past the last seek.
          render(getTime());
        }, windowMs - elapsed);
      }
    },
    dispose() {
      if (trailingTimer !== null) clearTimeout(trailingTimer);
      trailingTimer = null;
    },
  };
}
