import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

/** Distance from the bottom within which the container counts as pinned. */
const PIN_THRESHOLD_PX = 40;

/**
 * Keeps a scrollable container pinned to the bottom while content grows.
 * The pin detaches as soon as the user scrolls up (re-attaching when they
 * scroll back to the bottom) so manual scrolling is respected during
 * playback.
 */
export function usePinnedAutoScroll(watchValue: unknown): {
  containerRef: RefObject<HTMLDivElement | null>;
  pinned: boolean;
  pin: () => void;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);

  const updatePinned = useCallback((value: boolean) => {
    pinnedRef.current = value;
    setPinned(value);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const distance =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      updatePinned(distance < PIN_THRESHOLD_PX);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [updatePinned]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pinnedRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [watchValue]);

  const pin = useCallback(() => {
    updatePinned(true);
    const container = containerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [updatePinned]);

  return { containerRef, pinned, pin };
}
