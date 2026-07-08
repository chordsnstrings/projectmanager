import { useState } from 'react';
import type { CreateMeetingBody, MeetingDTO, MemberLite } from '@cadence/shared';

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtDur(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${m}m` : `${h}h`;
}
/** value for <input type="datetime-local"> one hour from now, in local time. */
function defaultWhen(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CreateMeeting({ roster, onCreate }: { roster: MemberLite[]; onCreate: (b: CreateMeetingBody) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(defaultWhen());
  const [duration, setDuration] = useState('30');
  const [location, setLocation] = useState('');
  const [agenda, setAgenda] = useState('');
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (id: string) =>
    setIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const valid = title.trim() && when && ids.size > 0 && new Date(when).getTime() > Date.now();

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onCreate({
        title: title.trim(),
        scheduledAt: new Date(when).toISOString(),
        durationMinutes: Math.max(5, Math.round(Number(duration) || 30)),
        location: location.trim() || null,
        agenda: agenda.trim() || null,
        attendeeIds: [...ids],
      });
      setTitle('');
      setLocation('');
      setAgenda('');
      setIds(new Set());
      setWhen(defaultWhen());
    } catch {
      setErr('Couldn’t schedule the meeting.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-4 flex flex-col gap-3">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title" className="field h-9 px-3 text-sm" />
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1">
          <span className="label">when</span>
          <input type="datetime-local" value={when} min={defaultWhen()} onChange={(e) => setWhen(e.target.value)} className="field h-9 px-2.5 text-xs font-mono [color-scheme:dark]" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">duration (min)</span>
          <input value={duration} onChange={(e) => setDuration(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className="field h-9 px-2.5 text-xs font-mono w-24" />
        </label>
        <label className="flex flex-col gap-1 flex-1 min-w-[10rem]">
          <span className="label">location / link</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room or video link" className="field h-9 px-3 text-sm" />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="label">agenda (optional)</span>
        <textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={2} placeholder="What the meeting is about" className="field px-3 py-2 text-sm resize-y" />
      </label>
      <div className="flex flex-col gap-1">
        <span className="label">attendees · {ids.size}</span>
        <div className="flex flex-wrap gap-1.5">
          {roster.map((m) => {
            const on = ids.has(m.id);
            return (
              <button key={m.id} type="button" onClick={() => toggle(m.id)} className={`chip font-mono text-[11px] ${on ? 'border-brass/50 text-brass bg-brass/10' : 'text-text3'}`}>
                {on ? '✓ ' : ''}
                {m.githubLogin}
              </button>
            );
          })}
          {roster.length === 0 && <span className="font-mono text-[11px] text-text3">no team members to invite</span>}
        </div>
      </div>
      <div className="flex items-center gap-3 justify-end">
        {err && <span className="font-mono text-[11px] text-danger mr-auto">{err}</span>}
        <button type="button" onClick={submit} disabled={!valid || busy} className="btn btn-sm btn-primary disabled:bg-surface2 disabled:text-text3">
          {busy ? 'scheduling…' : 'Schedule meeting'}
        </button>
      </div>
    </div>
  );
}

export default function MeetingsPanel({
  meetings,
  roster,
  onCreate,
  onCancel,
}: {
  meetings: MeetingDTO[] | null;
  roster: MemberLite[];
  onCreate: (b: CreateMeetingBody) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text tracking-tightish">Upcoming meetings</h2>
        <button onClick={() => setCreating((v) => !v)} className="btn btn-sm btn-primary">
          {creating ? 'close' : '+ Schedule meeting'}
        </button>
      </div>

      {creating && <CreateMeeting roster={roster} onCreate={async (b) => { await onCreate(b); setCreating(false); }} />}

      {meetings === null ? (
        <div className="card px-4 py-8 text-center font-mono text-xs text-text3">loading…</div>
      ) : meetings.length === 0 ? (
        <div className="card px-4 py-8 text-center font-mono text-xs text-text3">No upcoming meetings. Schedule one above.</div>
      ) : (
        <ul className="card overflow-hidden">
          {meetings.map((m) => (
            <li key={m.id} className="flex items-start gap-3 px-4 py-3 border-b border-hair last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-text tracking-tightish">{m.title}</div>
                <div className="font-mono text-[11px] text-text3 mt-0.5">
                  {fmtWhen(m.scheduledAt)} · {fmtDur(m.durationMinutes)}
                  {m.location ? ` · ${m.location}` : ''}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.attendees.map((a) => (
                    <span key={a.userId} className="font-mono text-[10px] text-text2 rounded bg-surface2 px-1.5 py-0.5">{a.githubLogin}</span>
                  ))}
                </div>
                {m.agenda && <div className="text-[12px] text-text2 mt-1.5 whitespace-pre-wrap">{m.agenda}</div>}
              </div>
              <button
                type="button"
                disabled={busyId === m.id}
                onClick={async () => {
                  setBusyId(m.id);
                  try {
                    await onCancel(m.id);
                  } finally {
                    setBusyId(null);
                  }
                }}
                className="btn btn-sm border-danger/40 text-danger hover:bg-danger/10 shrink-0"
              >
                {busyId === m.id ? '…' : 'cancel'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
