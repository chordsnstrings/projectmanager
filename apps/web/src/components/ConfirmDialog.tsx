import { useEffect, useState } from 'react';
import { useLockBodyScroll } from '../lib/useModal';

/**
 * Design-system confirm dialog replacing window.confirm. Promise-based:
 *   if (await confirmDialog({ title, body, confirmLabel, danger })) …
 * One <ConfirmDialogHost /> is mounted at the App root; one dialog at a time.
 */
export interface ConfirmOpts {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

let pendingResolve: ((ok: boolean) => void) | null = null;

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    // A second confirm while one is open cancels the first (shouldn't happen in practice).
    pendingResolve?.(false);
    pendingResolve = resolve;
    window.dispatchEvent(new CustomEvent('app-confirm', { detail: opts }));
  });
}

export default function ConfirmDialogHost() {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);

  useEffect(() => {
    const h = (e: Event) => setOpts((e as CustomEvent<ConfirmOpts>).detail);
    window.addEventListener('app-confirm', h);
    return () => window.removeEventListener('app-confirm', h);
  }, []);

  const settle = (ok: boolean) => {
    setOpts(null);
    pendingResolve?.(ok);
    pendingResolve = null;
  };

  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false);
      if (e.key === 'Enter') settle(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useLockBodyScroll(opts != null);

  if (!opts) return null;
  return (
    <div
      className="fixed inset-0 z-[75] grid place-items-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={() => settle(false)}
      role="alertdialog"
      aria-modal="true"
      aria-label={opts.title}
    >
      <div className="card w-full max-w-sm p-5 flex flex-col gap-3 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-text tracking-tightish">{opts.title}</h2>
        {opts.body && <p className="text-[13px] text-text2 leading-relaxed whitespace-pre-wrap">{opts.body}</p>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={() => settle(false)} className="btn btn-sm btn-ghost">
            {opts.cancelLabel ?? 'Cancel'}
          </button>
          <button
            autoFocus
            onClick={() => settle(true)}
            className={`btn btn-sm ${opts.danger ? 'btn-danger' : 'btn-primary'}`}
          >
            {opts.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
