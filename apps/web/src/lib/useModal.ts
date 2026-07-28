import { useEffect } from 'react';

// Reference-counted so overlapping overlays (e.g. the "what's new" modal AND the
// daily check-in mounting together) can't corrupt the restore: overflow is set
// once on the first lock and restored only when the LAST lock releases. The old
// per-hook save/restore left `overflow: hidden` stuck on the body when two
// overlays unmounted in the opposite order they mounted — freezing the page.
let lockCount = 0;
let savedOverflow = '';

/** Lock the page behind an open overlay so only the overlay scrolls. */
export function useLockBodyScroll(active = true): void {
  useEffect(() => {
    if (!active) return;
    if (lockCount === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        document.body.style.overflow = savedOverflow;
      }
    };
  }, [active]);
}

/** Call the handler on Escape — standard close affordance for overlays. */
export function useEscape(onEscape: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onEscape, active]);
}
