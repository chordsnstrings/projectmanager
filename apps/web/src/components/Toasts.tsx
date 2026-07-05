import { useEffect, useState } from 'react';

/**
 * Lightweight global toasts. Fire-and-forget from anywhere via toast(); the
 * <Toasts /> host (mounted once at the App root) stacks them bottom-center and
 * auto-dismisses. Use for action feedback that has no inline home — failures
 * that were previously swallowed, and confirmations of destructive actions.
 */
export type ToastTone = 'error' | 'success' | 'info';

export function toast(message: string, tone: ToastTone = 'info'): void {
  window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, tone } }));
}

interface Item {
  id: number;
  message: string;
  tone: ToastTone;
}

const TONE_CLS: Record<ToastTone, string> = {
  error: 'border-danger/40 text-danger',
  success: 'border-success/40 text-success',
  info: 'border-hair2 text-text2',
};

let nextId = 1;

export default function Toasts() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    const h = (e: Event) => {
      const { message, tone } = (e as CustomEvent<{ message: string; tone: ToastTone }>).detail;
      const id = nextId++;
      setItems((prev) => [...prev.slice(-2), { id, message, tone }]); // max 3 on screen
      window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3800);
    };
    window.addEventListener('app-toast', h);
    return () => window.removeEventListener('app-toast', h);
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] flex flex-col items-center gap-2 pointer-events-none px-4 w-full max-w-md">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`card px-3.5 py-2 font-mono text-[12px] shadow-pop animate-fade-in pointer-events-auto max-w-full truncate ${TONE_CLS[t.tone]}`}
          onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
