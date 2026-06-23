import { useState } from 'react';
import { api, ApiError } from '../lib/api';

interface Result {
  ran: boolean;
  skipped?: string;
  remindersSent: number;
  urgentCount: number;
  adminNotified: boolean;
}

/** Admin: run the login-reminder check now (bypasses the daily/Friday gate). */
export default function RunLoginCheckButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    setErr(false);
    try {
      const r = await api<Result>('/dashboard/run-login-check', { method: 'POST' });
      setErr(false);
      setMsg(
        r.remindersSent === 0 && r.urgentCount === 0
          ? 'Everyone is active — no emails sent.'
          : `Reminders ${r.remindersSent}${r.urgentCount ? ` · URGENT ${r.urgentCount}` : ''}${r.adminNotified ? ' · admin notified' : ''}`,
      );
    } catch (e) {
      setErr(true);
      setMsg(e instanceof ApiError && e.status === 503 ? 'Email not configured (SMTP).' : 'Check failed.');
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 7000);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {msg && <span className={`font-mono text-[11px] ${err ? 'text-danger' : 'text-success'}`}>{msg}</span>}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="btn btn-sm btn-ghost"
        title="email reminders to anyone who hasn't logged in (24h) and alert on 48h"
      >
        {busy ? 'checking…' : '⏱ Check logins'}
      </button>
    </div>
  );
}
