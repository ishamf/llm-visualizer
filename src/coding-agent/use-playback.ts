import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Largest wall-clock delta advanced per animation frame. Frames stop firing
 * while the tab is unfocused, and the cap prevents a burst of accumulated
 * time on refocus — so playback effectively pauses while unfocused instead
 * of jumping ahead.
 */
const MAX_FRAME_DELTA_SECONDS = 0.1;

export type Playback = {
  /** Current playback position in seconds, clamped to `[0, duration]`. */
  time: number;
  playing: boolean;
  play: () => void;
  pause: () => void;
  /** Resumes from the start when already at the end, otherwise toggles. */
  toggle: () => void;
  seek: (time: number) => void;
};

export function usePlayback(
  durationSeconds: number,
  { autoPlay = false }: { autoPlay?: boolean } = {},
): Playback {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timeRef = useRef(0);
  const durationRef = useRef(0);
  const autoPlayPending = useRef(autoPlay);

  useEffect(() => {
    durationRef.current = durationSeconds;
  }, [durationSeconds]);

  const clamp = useCallback(
    (value: number) =>
      Math.min(Math.max(value, 0), Math.max(0, durationRef.current)),
    [],
  );

  const seek = useCallback(
    (value: number) => {
      const next = clamp(value);
      timeRef.current = next;
      setTime(next);
    },
    [clamp],
  );

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
      if (previous !== undefined) {
        const delta = Math.min(
          (now - previous) / 1000,
          MAX_FRAME_DELTA_SECONDS,
        );
        const next = timeRef.current + delta;
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

  return { time, playing, play, pause, toggle, seek };
}
