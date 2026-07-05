import { useEffect } from 'react';

/**
 * Visibility-aware polling: ticks every `ms` while the tab is visible, skips
 * ticks while hidden (no wasted requests), and fires immediately when the tab
 * becomes visible again — so returning users see fresh data instantly instead
 * of waiting out the remainder of the interval.
 */
export function usePoll(fn: () => unknown, ms: number, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void fn();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fn();
    };
    const id = window.setInterval(tick, ms);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fn, ms, enabled]);
}
