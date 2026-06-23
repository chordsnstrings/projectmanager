import { useState } from 'react';
import { api, ApiError } from '../lib/api';

interface DigestResult {
  verified: boolean;
  adminRecipients: number;
  devsSent: number;
}

/** Admin: send the email digest now (verifies SMTP + delivers to recipients). */
export default function SendDigestButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const send = async () => {
    setBusy(true);
    setMsg(null);
    setErr(false);
    try {
      const r = await api<DigestResult>('/dashboard/send-digest?devs=1', { method: 'POST' });
      setErr(!r.verified || r.adminRecipients === 0);
      setMsg(
        !r.verified
          ? 'SMTP did not connect — check credentials.'
          : r.adminRecipients === 0
            ? 'Connected, but no admin recipient. Set DIGEST_TO or an admin email.'
            : `Sent ✓ ${r.adminRecipients} admin · ${r.devsSent} dev`,
      );
    } catch (e) {
      setErr(true);
      setMsg(e instanceof ApiError && e.status === 503 ? 'Email not configured (SMTP).' : 'Send failed.');
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 6000);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span className={`font-mono text-[11px] ${err ? 'text-danger' : 'text-success'}`}>{msg}</span>
      )}
      <button
        type="button"
        onClick={send}
        disabled={busy}
        className="btn btn-sm btn-ghost"
        title="send the team digest + per-dev nudges now"
      >
        {busy ? 'sending…' : '✉ Send digest now'}
      </button>
    </div>
  );
}
