import { useState } from 'react';

// Local copy (the runtime value can't be pulled from the CommonJS-built shared pkg).
const OFF_TASK_LABELS = ['meeting', 'research', 'study', 'review', 'pairing', 'planning'] as const;

function todayAt(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.toISOString();
}

/** Start a non-git activity now, or backfill a completed block for today. */
export default function AddActivity({
  onStartLabeled,
  onBackfill,
}: {
  onStartLabeled: (label: string) => void;
  onBackfill: (label: string, startedAt: string, endedAt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState<string>(OFF_TASK_LABELS[0]);
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('10:00');
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    const s = todayAt(from);
    const e = todayAt(to);
    if (new Date(e) <= new Date(s)) return setErr('end must be after start');
    if (new Date(e) > new Date()) return setErr('cannot log future time');
    setErr(null);
    onBackfill(label, s, e);
    setOpen(false);
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-text3 mr-1">+ log time</span>
        {OFF_TASK_LABELS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => onStartLabeled(l)}
            className="font-mono text-xs px-2.5 h-8 rounded-full border border-hair text-text2 hover:text-text hover:border-hair2"
            title={`start a ${l} session now`}
          >
            {l}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="font-mono text-xs px-2.5 h-8 rounded-full border border-dashed border-hair2 text-text3 hover:text-text2"
        >
          backfill…
        </button>
      </div>

      {open && (
        <div className="mt-3 rounded-lg border border-hair bg-panel p-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wide text-text3">activity</span>
            <select
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="font-mono text-xs bg-surface border border-hair rounded px-2 h-9 text-text [color-scheme:dark]"
            >
              {OFF_TASK_LABELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wide text-text3">from</span>
            <input
              type="time"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="font-mono text-xs bg-surface border border-hair rounded px-2 h-9 text-text [color-scheme:dark]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wide text-text3">to</span>
            <input
              type="time"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="font-mono text-xs bg-surface border border-hair rounded px-2 h-9 text-text [color-scheme:dark]"
            />
          </label>
          <button
            type="button"
            onClick={submit}
            className="font-mono text-xs px-3 h-9 rounded bg-brass text-bg font-medium hover:opacity-90"
          >
            add to today
          </button>
          {err && <span className="font-mono text-[11px] text-danger">{err}</span>}
        </div>
      )}
    </div>
  );
}
