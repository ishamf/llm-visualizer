import { ActionIcon, SegmentedControl, Slider, Text } from '@mantine/core';
import { useCallback, useRef, useState } from 'react';

import { formatClock } from './format.ts';
import type { SeekOptions } from './use-playback.ts';
import styles from './PlaybackBar.module.css';

const PLAYBACK_SPEEDS = [0.5, 1, 2, 3, 4] as const;

type PlaybackBarProps = {
  time: number;
  duration: number;
  playing: boolean;
  speed: number;
  onToggle: () => void;
  onSpeedChange: (speed: number) => void;
  /**
   * Seeks the replay. Fires at pointer/rAF rate while the thumb is dragged;
   * the experience throttles the re-renders (see `usePlayback`). The release
   * position arrives with `immediate`, so it renders without waiting for the
   * throttle's trailing update.
   */
  onSeek: (time: number, options?: SeekOptions) => void;
  /** Marks scrub start/end so playback can hold while the thumb drags. */
  onScrubStart: () => void;
  onScrubEnd: () => void;
};

export function PlaybackBar({
  time,
  duration,
  playing,
  speed,
  onToggle,
  onSpeedChange,
  onSeek,
  onScrubStart,
  onScrubEnd,
}: PlaybackBarProps) {
  // The thumb follows the pointer during a scrub: the slider is controlled
  // by `time`, whose renders are throttled while scrubbing, so the dragged
  // position is tracked locally until the release lands (immediately) and
  // playback takes the value back over.
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  const scrubbingRef = useRef(false);
  // Mantine debounces its change handling with a rAF, so the final change of
  // a fast flick can arrive after `onChangeEnd` has already fired. It is
  // applied as a one-off immediate seek instead of restarting a scrub whose
  // end would never come — that would hold playback forever.
  const scrubJustEndedRef = useRef(false);
  const shownTime = scrubValue ?? Math.min(time, duration);

  const handleScrub = useCallback(
    (value: number) => {
      if (!scrubbingRef.current) {
        if (scrubJustEndedRef.current) {
          scrubJustEndedRef.current = false;
          onSeek(value, { immediate: true });
          return;
        }
        scrubbingRef.current = true;
        onScrubStart();
      }
      setScrubValue(value);
      onSeek(value);
    },
    [onSeek, onScrubStart],
  );

  const handleScrubEnd = useCallback(
    (value: number) => {
      scrubbingRef.current = false;
      scrubJustEndedRef.current = true;
      setScrubValue(null);
      onScrubEnd();
      // The release position is final — render it right away instead of
      // waiting for the throttle's trailing update.
      onSeek(value, { immediate: true });
    },
    [onSeek, onScrubEnd],
  );

  return (
    <div className={styles.playbackBar}>
      <ActionIcon
        className={styles.playButton}
        variant="light"
        color="violet"
        size="lg"
        radius="xl"
        onClick={onToggle}
        disabled={duration <= 0}
        aria-label={playing ? 'Pause playback' : 'Start playback'}
      >
        <span className={styles.playIcon} data-playing={playing} />
      </ActionIcon>
      <Text
        className={`${styles.clock} ${styles.clockCurrent}`}
        size="sm"
        c="dimmed"
      >
        {formatClock(shownTime)}
      </Text>
      <Slider
        className={styles.seekSlider}
        value={shownTime}
        max={Math.max(duration, 0.01)}
        step={0.01}
        min={0}
        label={(value) => formatClock(value)}
        onChange={handleScrub}
        onChangeEnd={handleScrubEnd}
        aria-label="Seek playback"
      />
      <Text
        className={`${styles.clock} ${styles.clockDuration}`}
        size="sm"
        c="dimmed"
      >
        {formatClock(duration)}
      </Text>
      <SegmentedControl
        className={styles.speedControl}
        size="xs"
        color="violet"
        value={String(speed)}
        onChange={(value) => onSpeedChange(Number(value))}
        data={PLAYBACK_SPEEDS.map((value) => ({
          value: String(value),
          label: `${value}×`,
        }))}
        aria-label="Playback speed"
      />
    </div>
  );
}
