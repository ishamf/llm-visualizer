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
   * Whether `watchValue` changes scroll the container back to the bottom.
   * `false` turns the container into a static view: nothing ever scrolls
   * automatically. Toggling this never scrolls by itself.
   */
  follow?: boolean;
};

/**
 * Keeps a scrollable container pinned to the bottom while content grows.
 * The pin detaches as soon as the user scrolls up (re-attaching when they
 * scroll back to the bottom) so manual scrolling is respected during
 * playback.
 */
export function usePinnedAutoScroll(
  watchValue: unknown,
  { follow = true }: PinnedAutoScrollOptions = {},
): {
  containerRef: RefObject<HTMLDivElement | null>;
  pinned: boolean;
  pin: () => void;
  unpin: () => void;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const lastScrollHeightRef = useRef(0);
  const [pinned, setPinned] = useState(true);
  // Mirrors `follow` for the auto-scroll effect, which only depends on
  // `watchValue`: the mirror lets mode toggles happen without firing the
  // effect, so they never scroll by themselves.
  const followRef = useRef(follow);

  const updatePinned = useCallback((value: boolean) => {
    pinnedRef.current = value;
    setPinned(value);
  }, []);

  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    lastScrollTopRef.current = container.scrollTop;
    lastScrollHeightRef.current = container.scrollHeight;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
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
      const distance = scrollHeight - scrollTop - clientHeight;
      updatePinned(distance < PIN_THRESHOLD_PX);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [updatePinned]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pinnedRef.current || !followRef.current) return;
    container.scrollTop = container.scrollHeight;
    // `pinned` is a dependency on purpose: attaching the pin can itself
    // change content height (attaching unfreezes the away-collapse, which
    // expands the newest thinking block), and the scroll event that pin()
    // generates is processed after that growth — the handler would then
    // read a stale distance past the threshold and detach again. Scrolling
    // to the bottom once more after the re-render keeps the pin attached.
  }, [watchValue, pinned]);

  const pin = useCallback(() => {
    updatePinned(true);
    const container = containerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [updatePinned]);

  /** Detaches the pin without scrolling; playback stops auto-following. */
  const unpin = useCallback(() => {
    updatePinned(false);
  }, [updatePinned]);

  return { containerRef, pinned, pin, unpin };
}
