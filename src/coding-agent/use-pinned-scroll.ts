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

export type PinnedAutoScrollOptions = {
  /**
   * Element whose bottom edge is the live edge of the content, such as the
   * newest request's card. The pin then tracks that edge instead of the
   * container's bottom, so content appended after it (dimmed future
   * requests) never affects pinning or scrolling. When omitted — or while
   * the element is detached — the container's content end is the live edge.
   */
  endRef?: RefObject<HTMLElement | null>;
};

/**
 * Keeps a scrollable container pinned to the bottom while content grows.
 * The pin detaches as soon as the user scrolls up (re-attaching when they
 * scroll back to the bottom) so manual scrolling is respected during
 * playback.
 */
export function usePinnedAutoScroll(
  watchValue: unknown,
  { endRef }: PinnedAutoScrollOptions = {},
): {
  containerRef: RefObject<HTMLDivElement | null>;
  pinned: boolean;
  pin: () => void;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const lastScrollHeightRef = useRef(0);
  const [pinned, setPinned] = useState(true);

  const updatePinned = useCallback((value: boolean) => {
    pinnedRef.current = value;
    setPinned(value);
  }, []);

  /**
   * Distance from the viewport bottom to the live edge's bottom; negative
   * when the edge is above it (the user scrolled up).
   */
  const distanceToEnd = useCallback(() => {
    const container = containerRef.current;
    if (!container) return Number.POSITIVE_INFINITY;
    const end = endRef?.current;
    if (!end) {
      return (
        container.scrollHeight - container.scrollTop - container.clientHeight
      );
    }
    return (
      container.getBoundingClientRect().bottom -
      end.getBoundingClientRect().bottom
    );
  }, [endRef]);

  /** Puts the live edge's bottom at the viewport bottom. */
  const scrollToEdge = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const end = endRef?.current;
    if (!end) {
      container.scrollTop = container.scrollHeight;
      return;
    }
    container.scrollTop +=
      end.getBoundingClientRect().bottom -
      container.getBoundingClientRect().bottom;
  }, [endRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    lastScrollTopRef.current = container.scrollTop;
    lastScrollHeightRef.current = container.scrollHeight;
    const handleScroll = () => {
      const { scrollTop, scrollHeight } = container;
      // Content shrinking (e.g. a thinking block collapsing) clamps
      // scrollTop downwards and fires a scroll event; that is not the user
      // scrolling, so only count upward movement on unchanged content.
      const goingUp = scrollTop < lastScrollTopRef.current - 1;
      const contentShrank = scrollHeight < lastScrollHeightRef.current;
      lastScrollTopRef.current = scrollTop;
      lastScrollHeightRef.current = scrollHeight;
      if (goingUp && !contentShrank) {
        updatePinned(false);
        return;
      }
      updatePinned(distanceToEnd() < PIN_THRESHOLD_PX);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [updatePinned, distanceToEnd]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pinnedRef.current) return;
    scrollToEdge();
  }, [watchValue, scrollToEdge]);

  const pin = useCallback(() => {
    updatePinned(true);
    scrollToEdge();
  }, [updatePinned, scrollToEdge]);

  return { containerRef, pinned, pin };
}
