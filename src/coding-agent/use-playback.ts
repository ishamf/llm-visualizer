import { useCallback, useEffect, useRef, useState } from 'react';

import { createSeekThrottle, type SeekThrottle } from './seek-throttle.ts';

/**
 * Largest wall-clock delta advanced per animation frame. Frames stop firing
 * while the tab is unfocused, and the cap prevents a burst of accumulated
 * time on refocus — so playback effectively pauses while unfocused instead
 * of jumping ahead.
 */
const MAX_FRAME_DELTA_SECONDS = 0.1;

/**
 * Minimum interval between rendered updates while scrubbing the seek bar.
 * The slider reports changes at pointer/rAF rate (60+ per second); each
 * render re-derives the whole transcript snapshot, which stutters the page
 * when the thumb sweeps far. The authoritative time still follows every
 * change exactly — only the re-render is throttled, with a trailing update
 * so the final position always lands (see `createSeekThrottle`).
 *
 * Tuning knob: raise it to bound scrub re-renders further, lower it to make
 * mid-drag renders fresher.
 */
export const SEEK_RENDER_THROTTLE_MS = 100;

export type SeekOptions = {
  /** Bypass the throttle and render immediately (e.g. scrub release). */
  immediate?: boolean;
};

export type Playback = {
  /** Current playback position in seconds, clamped to `[0, duration]`. */
  time: number;
  playing: boolean;
  /** Playback rate multiplier: 1 is real time, 2 is twice as fast, etc. */
  speed: number;
  setSpeed: (speed: number) => void;
  play: () => void;
  pause: () => void;
  /** Resumes from the start when already at the end, otherwise toggles. */
  toggle: () => void;
  /**
   * Seeks the replay. While scrubbing, renders at most once per
   * `SEEK_RENDER_THROTTLE_MS` with a trailing update; pass `immediate` for
   * a seek that must render right away (e.g. the thumb's release position).
   */
  seek: (time: number, options?: SeekOptions) => void;
  /**
   * Marks the start of a seek-bar scrub: playback holds (the animation loop
   * stops advancing) until {@link endScrub}, so dragging while playing does
   * not render a far jump every frame. Playback resumes from the current
   * time when the scrub ends.
   */
  beginScrub: () => void;
  /** Marks the end of a seek-bar scrub; playback resumes. */
  endScrub: () => void;
};

export function usePlayback(
  durationSeconds: number,
  { autoPlay = false }: { autoPlay?: boolean } = {},
): Playback {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timeRef = useRef(0);
  const durationRef = useRef(0);
  const speedRef = useRef(1);
  const autoPlayPending = useRef(autoPlay);
  /** True while the seek bar is being dragged; the loop holds (see type). */
  const scrubbingRef = useRef(false);
  // Created on mount (seeks only originate in user events, which fire after
  // mount); `getTime` reads `timeRef` lazily when a trailing update fires.
  const seekThrottleRef = useRef<SeekThrottle | null>(null);
  useEffect(() => {
    seekThrottleRef.current = createSeekThrottle({
      windowMs: SEEK_RENDER_THROTTLE_MS,
      render: setTime,
      getTime: () => timeRef.current,
    });
    return () => seekThrottleRef.current?.dispose();
  }, []);

  useEffect(() => {
    durationRef.current = durationSeconds;
  }, [durationSeconds]);

  const changeSpeed = useCallback((value: number) => {
    speedRef.current = value;
    setSpeed(value);
  }, []);

  const clamp = useCallback(
    (value: number) =>
      Math.min(Math.max(value, 0), Math.max(0, durationRef.current)),
    [],
  );

  const seek = useCallback(
    (value: number, options?: SeekOptions) => {
      const next = clamp(value);
      // The ref is authoritative — playback resumes from it and the
      // animation loop advances it — so it always follows the seek exactly;
      // only the re-render goes through the throttle.
      timeRef.current = next;
      seekThrottleRef.current?.seek(next, options);
    },
    [clamp],
  );

  const beginScrub = useCallback(() => {
    scrubbingRef.current = true;
  }, []);

  const endScrub = useCallback(() => {
    scrubbingRef.current = false;
  }, []);

  const play = useCallback(() => {
    if (durationRef.current <= 0) return;
    if (timeRef.current >= durationRef.current) {
      seek(0);
    }
    setPlaying(true);
  }, [seek]);

  const pause = useCallback(() => setPlaying(false), []);

  const toggle = useCallback(() => {
    if (timeRef.current >= durationRef.current && durationRef.current > 0) {
      seek(0);
      setPlaying(true);
      return;
    }
    setPlaying((currentlyPlaying) => !currentlyPlaying);
  }, [seek]);

  useEffect(() => {
    if (!autoPlayPending.current || durationRef.current <= 0) return;
    autoPlayPending.current = false;
    setPlaying(true);
  }, [durationSeconds]);

  useEffect(() => {
    if (!playing) return;
    let frame: number;
    let previous: number | undefined;
    const step = (now: number) => {
      // While the seek bar is dragged, playback holds: the scrub renders its
      // own positions (throttled), and resuming advances from the released
      // time — a running loop would re-render a far jump every frame.
      if (previous !== undefined && !scrubbingRef.current) {
        const delta = Math.min(
          (now - previous) / 1000,
          MAX_FRAME_DELTA_SECONDS,
        );
        const next = timeRef.current + delta * speedRef.current;
        if (next >= durationRef.current) {
          timeRef.current = durationRef.current;
          setTime(durationRef.current);
          setPlaying(false);
          return;
        }
        timeRef.current = next;
        setTime(next);
      }
      previous = now;
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  return {
    time,
    playing,
    speed,
    setSpeed: changeSpeed,
    play,
    pause,
    toggle,
    seek,
    beginScrub,
    endScrub,
  };
}
