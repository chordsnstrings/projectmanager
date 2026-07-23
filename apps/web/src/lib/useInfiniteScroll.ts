import { useCallback, useRef } from 'react';

/**
 * Auto-load the next page when a sentinel scrolls near the viewport. Attach the
 * returned ref to the existing "show more" control — it stays visible as a
 * manual fallback, but is clicked for you as you approach it. A guard prevents
 * duplicate fires while a page is already in flight.
 */
export function useInfiniteScroll(
  onMore: (() => void) | undefined,
  enabled: boolean,
): (node: HTMLElement | null) => void {
  const observer = useRef<IntersectionObserver | null>(null);
  const loading = useRef(false);

  return useCallback(
    (node: HTMLElement | null) => {
      observer.current?.disconnect();
      if (!enabled || !onMore || !node) return;
      observer.current = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting && !loading.current) {
            loading.current = true;
            onMore();
            // release shortly after; the next page swaps this node's `enabled`
            // and re-creates the observer with a fresh guard.
            setTimeout(() => {
              loading.current = false;
            }, 400);
          }
        },
        { rootMargin: '240px' },
      );
      observer.current.observe(node);
    },
    [onMore, enabled],
  );
}
