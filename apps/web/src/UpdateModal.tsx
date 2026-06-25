import { useState } from 'react';
import type { Me } from '@cadence/shared';
import { APP_VERSION, entriesSince } from './lib/changelog';
import { Logo } from './components/Logo';

/**
 * One-time "what's new" modal. Shows every changelog entry newer than the
 * version the user last acknowledged, then records the current version so it
 * doesn't show again until the next update.
 */
export default function UpdateModal({ me, onAck }: { me: Me; onAck: (version: string) => void }) {
  const [open, setOpen] = useState(true);

  // Don't interrupt onboarding, and nothing to show if already current.
  if (!me.onboardingComplete || me.lastSeenVersion === APP_VERSION) return null;
  const entries = entriesSince(me.lastSeenVersion);
  if (entries.length === 0 || !open) return null;

  const dismiss = () => {
    setOpen(false);
    onAck(APP_VERSION);
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
    >
      <div className="card w-full max-w-md p-6 sm:p-7 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <Logo size={24} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text tracking-tightish">What’s new</h2>
            <p className="font-mono text-[11px] text-text3">
              v{entries[0]!.version} · {entries[0]!.date}
            </p>
          </div>
          <button onClick={dismiss} className="ml-auto text-text3 hover:text-text2 text-lg leading-none" aria-label="close">
            ×
          </button>
        </div>

        <div className="flex flex-col gap-4 max-h-[55vh] overflow-y-auto">
          {entries.map((e) => (
            <div key={e.version} className="flex flex-col gap-1.5">
              {entries.length > 1 && (
                <div className="font-mono text-[11px] text-text3">
                  v{e.version} · {e.date}
                </div>
              )}
              <div className="text-sm text-text tracking-tightish">{e.title}</div>
              <ul className="flex flex-col gap-1.5 mt-0.5">
                {e.items.map((item, i) => (
                  <li key={i} className="flex gap-2 text-[13px] text-text2 leading-relaxed">
                    <span className="text-brass shrink-0">·</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <button onClick={dismiss} className="btn btn-md btn-primary self-end">
          Got it
        </button>
      </div>
    </div>
  );
}
