import { ActionIcon, Slider, Text } from '@mantine/core';

import { formatClock } from './format.ts';
import styles from './PlaybackBar.module.css';

type PlaybackBarProps = {
  time: number;
  duration: number;
  playing: boolean;
  onToggle: () => void;
  onSeek: (time: number) => void;
};

export function PlaybackBar({
  time,
  duration,
  playing,
  onToggle,
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
      <Text className={styles.clock} size="sm" c="dimmed">
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
      <Text className={styles.clock} size="sm" c="dimmed">
        {formatClock(duration)}
      </Text>
    </div>
  );
}
