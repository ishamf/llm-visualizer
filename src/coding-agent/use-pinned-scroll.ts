import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

/**
 * Distance from the bottom within which the container re-attaches.
 * Releasing works differently: any deliberate upward scroll detaches
 * immediately, even a few pixels, so playback never fights the user.
 */
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
  const lastScrollTopRef = useRef(0);
  const [pinned, setPinned] = useState(true);

  const updatePinned = useCallback((value: boolean) => {
    pinnedRef.current = value;
    setPinned(value);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    lastScrollTopRef.current = container.scrollTop;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const goingUp = scrollTop < lastScrollTopRef.current - 1;
      lastScrollTopRef.current = scrollTop;
      if (goingUp) {
        updatePinned(false);
        return;
      }
      const distance = scrollHeight - scrollTop - clientHeight;
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
