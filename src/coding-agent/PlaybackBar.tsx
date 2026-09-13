import { ActionIcon, SegmentedControl, Slider, Text } from '@mantine/core';

import { formatClock } from './format.ts';
import styles from './PlaybackBar.module.css';

const PLAYBACK_SPEEDS = [0.5, 1, 2, 3, 4] as const;

type PlaybackBarProps = {
  time: number;
  duration: number;
  playing: boolean;
  speed: number;
  onToggle: () => void;
  onSpeedChange: (speed: number) => void;
  onSeek: (time: number) => void;
};

export function PlaybackBar({
  time,
  duration,
  playing,
  speed,
  onToggle,
  onSpeedChange,
  onSeek,
}: PlaybackBarProps) {
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
      <Text className={`${styles.clock} ${styles.clockCurrent}`} size="sm" c="dimmed">
        {formatClock(time)}
      </Text>
      <Slider
        className={styles.seekSlider}
        value={Math.min(time, duration)}
        max={Math.max(duration, 0.01)}
        step={0.01}
        min={0}
        label={(value) => formatClock(value)}
        onChange={onSeek}
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
