import { useEffect, useMemo, useState } from 'react';
import type { BlockerKey, CarryoverItem, CarryoverStatus, CheckinPrompt, Me } from '@cadence/shared';
import { api } from './lib/api';
import { Logo } from './components/Logo';

/**
 * Morning "start your day" check-in. Asked once per local day for onboarded team
 * members: reflect on yesterday (measured recap + self-rating), set each open
 * task's carry-over status, name the biggest blocker, and declare today's focus
 * + confidence. Skippable — but the skip is recorded so it won't reappear today.
 */
export default function CheckinModal({ me }: { me: Me }) {
  const [prompt, setPrompt] = useState<CheckinPrompt | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!me.onboardingComplete) return;
    let alive = true;
    void api<CheckinPrompt>('/me/checkin')
      .then((p) => {
        if (alive) setPrompt(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [me.onboardingComplete]);

  if (done || !prompt || !prompt.needed) return null;
  return <CheckinForm prompt={prompt} onClose={() => setDone(true)} />;
}

const BLOCKERS: { key: BlockerKey; label: string }[] = [
  { key: 'none', label: 'Nothing' },
  { key: 'review', label: 'Waiting on review' },
  { key: 'requirements', label: 'Unclear requirements' },
  { key: 'bug', label: 'Stuck on a bug' },
  { key: 'meetings', label: 'Meetings / context-switching' },
  { key: 'other', label: 'Something else' },
];

const CARRY: { key: CarryoverStatus; label: string; cls: string }[] = [
  { key: 'on_track', label: 'On track', cls: 'data-[on=true]:bg-success/15 data-[on=true]:text-success data-[on=true]:border-success/40' },
  { key: 'blocked', label: 'Blocked', cls: 'data-[on=true]:bg-danger/15 data-[on=true]:text-danger data-[on=true]:border-danger/40' },
  { key: 'dropping', label: 'Dropping', cls: 'data-[on=true]:bg-text3/20 data-[on=true]:text-text2 data-[on=true]:border-border2' },
];

function fmtMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function CheckinForm({ prompt, onClose }: { prompt: CheckinPrompt; onClose: () => void }) {
  const [productivity, setProductivity] = useState<number | null>(null);
  const [carry, setCarry] = useState<Record<string, CarryoverStatus>>({});
  const [blocker, setBlocker] = useState<BlockerKey | null>(null);
  const [blockerNote, setBlockerNote] = useState('');
  const [focusTaskIds, setFocusTaskIds] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState('');
  const [confidence, setConfidence] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const { yesterday, openTasks } = prompt;
  const nothingYesterday = yesterday.activeMinutes === 0 && yesterday.completed === 0;

  const carryover = useMemo<CarryoverItem[]>(
    () => Object.entries(carry).map(([taskId, status]) => ({ taskId, status })),
    [carry],
  );

  const submit = async () => {
    setBusy(true);
    try {
      await api('/me/checkin', {
        method: 'POST',
        body: JSON.stringify({
          productivity,
          blocker,
          blockerNote: blocker && blocker !== 'none' ? blockerNote.trim().slice(0, 500) || null : null,
          focus: focus.trim().slice(0, 500) || null,
          focusTaskIds: [...focusTaskIds],
          confidence,
          carryover,
        }),
      });
      onClose();
    } catch {
      setBusy(false);
    }
  };

  const skip = async () => {
    setBusy(true);
    await api('/me/checkin/skip', { method: 'POST', body: '{}' }).catch(() => {});
    onClose();
  };

  const toggleFocus = (id: string) =>
    setFocusTaskIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
    >
      <div className="card w-full max-w-md p-6 sm:p-7 flex flex-col gap-5 max-h-[88vh] overflow-y-auto animate-scale-in">
        <header className="flex items-center gap-3">
          <Logo size={24} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text tracking-tightish">Start your day</h2>
            <p className="font-mono text-[11px] text-text3">{prompt.localDate} · a quick check-in</p>
          </div>
          <button onClick={skip} disabled={busy} className="ml-auto text-text3 hover:text-text2 text-[12px] font-mono" aria-label="skip">
            skip
          </button>
        </header>

        {/* 1 — Yesterday recap + self-rating */}
        <section className="flex flex-col gap-2.5">
          <Label n={1}>How did yesterday go?</Label>
          <div className="rounded-lg border border-border bg-surface px-3 py-2.5 font-mono text-[12px] text-text2 flex flex-wrap gap-x-4 gap-y-1">
            {nothingYesterday ? (
              <span className="text-text3">No tracked sessions yesterday</span>
            ) : (
              <>
                <span>
                  <span className="text-text3">active</span> {fmtMinutes(yesterday.activeMinutes)}
                </span>
                <span>
                  <span className="text-text3">completed</span> {yesterday.completed}
                </span>
                <span>
                  <span className="text-text3">in&nbsp;progress</span> {yesterday.inProgress}
                </span>
              </>
            )}
          </div>
          <Rating value={productivity} onChange={setProductivity} lowLabel="Unproductive" highLabel="Very productive" />
        </section>

        {/* 2 — Per-task carry-over */}
        {openTasks.length > 0 && (
          <section className="flex flex-col gap-2.5">
            <Label n={2}>Where do your open tasks stand?</Label>
            <ul className="flex flex-col gap-2">
              {openTasks.map((t) => (
                <li key={t.id} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-[13px] text-text2 truncate min-w-0 sm:max-w-[55%]" title={t.title}>
                    {t.title}
                  </span>
                  <div className="flex gap-1 shrink-0">
                    {CARRY.map((c) => (
                      <button
                        key={c.key}
                        data-on={carry[t.id] === c.key}
                        onClick={() => setCarry((p) => ({ ...p, [t.id]: c.key }))}
                        className={`px-2 py-1 rounded-md border border-border text-[11px] font-mono text-text3 transition-colors hover:text-text2 ${c.cls}`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 3 — Biggest blocker */}
        <section className="flex flex-col gap-2.5">
          <Label n={openTasks.length > 0 ? 3 : 2}>What's slowing you down most?</Label>
          <div className="flex flex-wrap gap-1.5">
            {BLOCKERS.map((b) => (
              <button
                key={b.key}
                onClick={() => setBlocker((cur) => (cur === b.key ? null : b.key))}
                className={`px-2.5 py-1 rounded-md border text-[12px] font-mono transition-colors ${
                  blocker === b.key
                    ? 'border-brass/50 bg-brass/10 text-brass'
                    : 'border-border text-text3 hover:text-text2'
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
          {blocker && blocker !== 'none' && (
            <input
              value={blockerNote}
              onChange={(e) => setBlockerNote(e.target.value)}
              maxLength={500}
              placeholder="Add a detail (optional)"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-text placeholder:text-text3 focus:outline-none focus:border-border2"
            />
          )}
        </section>

        {/* 4 — Today's focus + confidence */}
        <section className="flex flex-col gap-2.5">
          <Label n={openTasks.length > 0 ? 4 : 3}>What's your focus today?</Label>
          {openTasks.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {openTasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => toggleFocus(t.id)}
                  className={`px-2.5 py-1 rounded-md border text-[12px] max-w-full truncate transition-colors ${
                    focusTaskIds.has(t.id)
                      ? 'border-brass/50 bg-brass/10 text-brass'
                      : 'border-border text-text3 hover:text-text2'
                  }`}
                  title={t.title}
                >
                  {t.title}
                </button>
              ))}
            </div>
          )}
          <input
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            maxLength={500}
            placeholder="Anything else you're aiming for…"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-text placeholder:text-text3 focus:outline-none focus:border-border2"
          />
          <Rating value={confidence} onChange={setConfidence} lowLabel="Uncertain" highLabel="Confident" />
        </section>

        <footer className="flex items-center gap-3 pt-1">
          <button onClick={skip} disabled={busy} className="btn btn-md text-text3 hover:text-text2">
            Skip today
          </button>
          <button onClick={submit} disabled={busy} className="btn btn-md btn-primary ml-auto">
            {busy ? 'Saving…' : 'Start the day'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Label({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid place-items-center w-4 h-4 rounded-full bg-surface2 font-mono text-[10px] text-text3 shrink-0">
        {n}
      </span>
      <span className="text-[13px] font-medium text-text">{children}</span>
    </div>
  );
}

/** 1–5 rating row. */
function Rating({
  value,
  onChange,
  lowLabel,
  highLabel,
}: {
  value: number | null;
  onChange: (n: number) => void;
  lowLabel: string;
  highLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={`flex-1 h-9 rounded-lg border font-mono text-[13px] transition-colors ${
              value === n
                ? 'border-brass/60 bg-brass/15 text-brass'
                : 'border-border text-text3 hover:text-text2 hover:border-border2'
            }`}
            aria-label={`${n} of 5`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-text3 px-0.5">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}
