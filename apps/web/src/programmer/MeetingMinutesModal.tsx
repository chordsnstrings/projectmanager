import { useMemo, useState } from 'react';
import type { MeetingMinutesItemDTO, SessionDTO } from '@cadence/shared';
import { Logo } from '../components/Logo';
import { useLockBodyScroll } from '../lib/useModal';
import { confirmDialog } from '../components/ConfirmDialog';

/**
 * Minutes of Meeting (MoM) — shown when a `meeting` off-task session is stopped.
 * Every field is required: the session only ends once a complete MoM is filed
 * (there is no skip). Cancelling leaves the meeting running.
 */
type EditKey = 'topic' | 'details' | 'decision' | 'responsible' | 'timeline' | 'remarks';
const ITEM_FIELDS: { key: EditKey; label: string; placeholder: string; wide?: boolean }[] = [
  { key: 'topic', label: 'Topic', placeholder: 'e.g. Revision of price' },
  { key: 'details', label: 'Details', placeholder: 'What was discussed', wide: true },
  { key: 'decision', label: 'Decision', placeholder: 'What was decided', wide: true },
  { key: 'responsible', label: 'Responsible', placeholder: 'Who owns it' },
  { key: 'timeline', label: 'Timeline', placeholder: 'e.g. Effective 1 Jul' },
  { key: 'remarks', label: 'Remarks', placeholder: 'Any notes' },
];

const emptyItem = (): MeetingMinutesItemDTO => ({
  topic: '',
  details: '',
  decision: '',
  responsible: '',
  timeline: '',
  remarks: '',
});

export default function MeetingMinutesModal({
  session,
  onSubmit,
  onCancel,
  onDiscard,
}: {
  session: SessionDTO;
  onSubmit: (sessionId: string, minutes: { date: string; attendees: string; agenda: string; items: MeetingMinutesItemDTO[] }) => Promise<void>;
  onCancel: () => void;
  /** discard a meeting started by mistake (no minutes, kept out of tracked time) */
  onDiscard?: (sessionId: string) => Promise<void>;
}) {
  useLockBodyScroll();
  const startDay = useMemo(() => new Date(session.startedAt).toLocaleDateString('en-CA'), [session.startedAt]);
  const [date, setDate] = useState(startDay);
  const [attendees, setAttendees] = useState('');
  const [agenda, setAgenda] = useState('');
  const [items, setItems] = useState<MeetingMinutesItemDTO[]>([emptyItem()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setItem = (i: number, key: EditKey, v: string) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [key]: v } : it)));
  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (i: number) => setItems((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  const complete =
    date.trim() &&
    attendees.trim() &&
    agenda.trim() &&
    items.length > 0 &&
    items.every((it) => Object.values(it).every((v) => v.trim().length > 0));

  const submit = async () => {
    if (!complete || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(session.id, { date: date.trim(), attendees: attendees.trim(), agenda: agenda.trim(), items });
      // parent unmounts on success
    } catch {
      setErr('Couldn’t save the minutes — please try again.');
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!onDiscard || busy) return;
    if (!(await confirmDialog({
      title: 'Discard this meeting?',
      body: 'It was started by mistake — no minutes are needed and it won’t count toward tracked time. This can’t be undone.',
      confirmLabel: 'Discard',
      danger: true,
    }))) return;
    setBusy(true);
    setErr(null);
    try {
      await onDiscard(session.id);
      // parent unmounts on success
    } catch {
      setErr('Couldn’t discard the meeting — please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true">
      <div className="card w-full max-w-2xl p-6 sm:p-7 flex flex-col gap-5 max-h-[90vh] overflow-y-auto animate-scale-in">
        <header className="flex items-center gap-3">
          <Logo size={24} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text tracking-tightish">Minutes of Meeting</h2>
            <p className="font-mono text-[11px] text-text3">Required before this meeting can end · all fields</p>
          </div>
        </header>

        {/* Header fields */}
        <section className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="label">date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field h-9 px-2.5 text-sm [color-scheme:dark]" />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="label">members present</span>
            <input value={attendees} onChange={(e) => setAttendees(e.target.value)} maxLength={2000} placeholder="Who attended" className="field h-9 px-3 text-sm" />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-3">
            <span className="label">meeting agenda</span>
            <input value={agenda} onChange={(e) => setAgenda(e.target.value)} maxLength={2000} placeholder="What the meeting was about" className="field h-9 px-3 text-sm" />
          </label>
        </section>

        {/* Agenda items */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="label">items · {items.length}</span>
            <button type="button" onClick={addItem} className="font-mono text-[11px] text-brass hover:text-brass/80">
              + add item
            </button>
          </div>
          {items.map((it, i) => (
            <div key={i} className="rounded-lg border border-hair bg-surface/40 p-3 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-text3">item {i + 1}</span>
                {items.length > 1 && (
                  <button type="button" onClick={() => removeItem(i)} className="font-mono text-[11px] text-text3 hover:text-danger">
                    remove
                  </button>
                )}
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {ITEM_FIELDS.map((f) => (
                  <label key={f.key} className={`flex flex-col gap-1 ${f.wide ? 'sm:col-span-2' : ''}`}>
                    <span className="label">{f.label}</span>
                    {f.wide ? (
                      <textarea
                        value={it[f.key]}
                        onChange={(e) => setItem(i, f.key, e.target.value)}
                        rows={2}
                        placeholder={f.placeholder}
                        className="field px-3 py-2 text-sm resize-y"
                      />
                    ) : (
                      <input
                        value={it[f.key]}
                        onChange={(e) => setItem(i, f.key, e.target.value)}
                        placeholder={f.placeholder}
                        className="field h-9 px-3 text-sm"
                      />
                    )}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </section>

        {err && <p className="font-mono text-[11px] text-danger">{err}</p>}

        <footer className="flex flex-col gap-2 pt-1 border-t border-hair">
          <div className="flex items-center gap-3">
            <button onClick={onCancel} disabled={busy} className="btn btn-md btn-ghost">
              Cancel · keep running
            </button>
            {!complete && <span className="font-mono text-[10px] text-text3 ml-auto">fill every field to end the meeting</span>}
            <button onClick={submit} disabled={!complete || busy} className={`btn btn-md btn-primary ${complete ? 'ml-auto' : ''}`}>
              {busy ? 'saving…' : 'Save & end meeting'}
            </button>
          </div>
          {onDiscard && (
            <button
              onClick={discard}
              disabled={busy}
              className="self-start font-mono text-[11px] text-text3 hover:text-danger disabled:opacity-50"
            >
              or discard — started by mistake
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
