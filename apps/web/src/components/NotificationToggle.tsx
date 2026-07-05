import { useEffect, useState } from 'react';
import { disablePush, enablePush, pushState, type PushState } from '../lib/push';

/**
 * Enable/disable Web Push for this device. Hidden entirely when the browser can't
 * do push or the server has no VAPID keys configured. Shows a clear hint when the
 * user has previously blocked notifications.
 */
export default function NotificationToggle({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void pushState().then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, []);

  // Nothing to show if unsupported or not configured server-side.
  if (state === null) return null;
  if (state === 'unsupported' || state === 'disabled') return null;

  const toggle = async () => {
    setBusy(true);
    const next = state === 'on' ? await disablePush() : await enablePush();
    setState(next);
    setBusy(false);
  };

  if (state === 'denied') {
    return (
      <div data-tour="bell" className={`font-mono text-[11px] text-text3 ${compact ? '' : 'flex items-center gap-2'}`}>
        notifications blocked — enable them in your browser settings
      </div>
    );
  }

  const on = state === 'on';
  return (
    <button
      data-tour="bell"
      onClick={toggle}
      disabled={busy}
      className={`btn btn-sm ${on ? 'btn-ghost text-success' : 'btn-ghost'}`}
      title={on ? 'Turn off push notifications on this device' : 'Get notified about questions, flags and your tasks'}
    >
      <span aria-hidden className="sm:mr-1.5">{on ? '🔔' : '🔕'}</span>
      <span className="hidden sm:inline">{busy ? '…' : on ? 'Notifications on' : 'Enable notifications'}</span>
    </button>
  );
}
