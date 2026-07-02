import { useCallback, useEffect, useRef, useState } from 'react';
import type { Me } from '@cadence/shared';
import { api } from './lib/api';

/**
 * First-login walkthrough: spotlights the real UI, one step at a time, tailored
 * to role + team. Runs automatically once per user (tracked server-side via
 * tourSeen) and can be replayed any time via startTour() — the guide (?) has a
 * "take the walkthrough" button. Steps anchor to [data-tour="…"] attributes;
 * anchors that aren't on screen are skipped, so it degrades gracefully.
 */
export function startTour(): void {
  window.dispatchEvent(new CustomEvent('start-tour'));
}

interface Step {
  anchor: string;
  title: string;
  body: string;
}

function memberSteps(teamKey: string | null): Step[] {
  const git = teamKey !== 'marketing';
  return [
    {
      anchor: 'prod',
      title: 'Your output, at a glance',
      body: 'Active time and completed tasks — today and the last 7 days. Sessions are the clock: only time you track shows up here. Tap it to open your progress.',
    },
    {
      anchor: 'pool',
      title: 'The team pool',
      body: 'Unassigned tasks for your team. Expand one to read the brief and discussion, then pick it up — or add a task of your own.',
    },
    {
      anchor: 'tasks',
      title: 'Your tasks',
      body: git
        ? 'Issues, PRs and branches synced from GitHub plus assigned tasks. Press ▶ to start a session — you’ll say what you’re about to do (one line). Press ■ to stop; a summary is drafted from your commits.'
        : 'Your assigned tasks. Press ▶ to start a session — you’ll say what you’re about to do (one line). Tap the activity chip while running to tag what kind of work it is.',
    },
    {
      anchor: 'addactivity',
      title: 'Off-task time counts too',
      body: 'Meetings, research, calls — start a labelled session or backfill a block you forgot. Better an honest off-task session than untracked time.',
    },
    {
      anchor: 'myday',
      title: 'Review your day',
      body: 'Your own timeline — every session, intent and summary. Managers see exactly this same data, nothing more.',
    },
    {
      anchor: 'bell',
      title: 'Stay in the loop',
      body: 'Turn on notifications to get pinged about questions, flags, assignments and comments — even when Cadence is closed.',
    },
    {
      anchor: 'guide',
      title: 'Need a refresher?',
      body: 'The full written guide lives here — and you can replay this walkthrough from it any time.',
    },
  ];
}

function managerSteps(isOwner: boolean): Step[] {
  return [
    {
      anchor: 'tab-team',
      title: 'People',
      body: 'The live roster: who’s running a session right now, today’s active time, estimates vs actuals. Click a person for their full day timeline.',
    },
    {
      anchor: 'tab-tasks',
      title: 'Tasks',
      body: 'Create tasks with a brief, assign owners and collaborators, let AI draft the step-by-step, check readiness, and approve — approval is the handoff.',
    },
    {
      anchor: 'tab-pulse',
      title: 'Pulse',
      body: 'From the morning check-ins: felt-vs-measured per member, sentiment trend, blocker breakdown and carry-over. For spotting quiet strugglers — not ranking.',
    },
    {
      anchor: 'tab-flags',
      title: 'Flags',
      body: 'Where declared sessions and observed git disagree, a flag is raised. Resolve, dismiss, or turn one into a question — each links to the person’s day for context.',
    },
    {
      anchor: 'tab-questions',
      title: 'Questions & the gate',
      body: 'Ask a member a question on a task. A blocking question gates their next task completion until answered — use it when you genuinely need the answer.',
    },
    ...(isOwner
      ? [
          {
            anchor: 'teamfilter',
            title: 'Scope by team',
            body: 'You see every team. Filter any view to one team here; leads only ever see their own.',
          },
        ]
      : []),
    {
      anchor: 'bell',
      title: 'Stay in the loop',
      body: 'Turn on notifications to hear about answers, flags and comments as they happen.',
    },
    {
      anchor: 'guide',
      title: 'Need a refresher?',
      body: 'The full written guide lives here — and you can replay this walkthrough from it any time.',
    },
  ];
}

function findAnchor(anchor: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
}

const PAD = 8;

export default function Walkthrough({ me, onSeen }: { me: Me; onSeen: () => void }) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const autoStarted = useRef(false);

  const begin = useCallback(() => {
    const all = me.role === 'dev' ? memberSteps(me.teamKey) : managerSteps(me.role === 'admin');
    const present = all.filter((s) => findAnchor(s.anchor));
    if (present.length === 0) return;
    setIdx(0);
    setSteps(present);
  }, [me.role, me.teamKey]);

  // Replay on demand (guide button).
  useEffect(() => {
    window.addEventListener('start-tour', begin);
    return () => window.removeEventListener('start-tour', begin);
  }, [begin]);

  // First login: run automatically once the board has rendered.
  useEffect(() => {
    if (me.tourSeen || !me.onboardingComplete || autoStarted.current) return;
    autoStarted.current = true;
    const t = window.setTimeout(begin, 900);
    return () => window.clearTimeout(t);
  }, [me.tourSeen, me.onboardingComplete, begin]);

  // Measure the current step's target (after scrolling it into view).
  useEffect(() => {
    if (!steps) return;
    const el = findAnchor(steps[idx]!.anchor);
    if (!el) {
      // Anchor vanished mid-tour (e.g. list emptied) — skip it.
      setIdx((i) => (i + 1 < steps.length ? i + 1 : i));
      return;
    }
    setRect(null);
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const measure = () => setRect(el.getBoundingClientRect());
    const t = window.setTimeout(measure, 380);
    window.addEventListener('resize', measure);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', measure);
    };
  }, [steps, idx]);

  const finish = useCallback(() => {
    setSteps(null);
    if (!me.tourSeen) {
      void api('/me/tour-seen', { method: 'POST', body: '{}' }).catch(() => {});
    }
    onSeen();
  }, [me.tourSeen, onSeen]);

  if (!steps) return null;
  const step = steps[idx]!;
  const last = idx === steps.length - 1;

  // Tooltip placement: below the target when there's room, otherwise above.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(340, vw - 24);
  let cardStyle: React.CSSProperties = { left: (vw - cardW) / 2, top: vh / 2 - 90, width: cardW };
  if (rect) {
    const below = rect.bottom + 12 + 190 < vh;
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - cardW / 2, vw - cardW - 12));
    cardStyle = below
      ? { left, top: rect.bottom + PAD + 10, width: cardW }
      : { left, bottom: vh - rect.top + PAD + 10, width: cardW };
  }

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="walkthrough">
      {/* Spotlight: the hole is drawn by the highlight's huge box-shadow. */}
      {rect ? (
        <div
          className="absolute rounded-xl border border-brass/60 transition-all duration-300 pointer-events-none"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.72)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/70" />
      )}
      {/* Click shield so the page isn't interacted with mid-tour. */}
      <div className="absolute inset-0" onClick={() => (last ? finish() : setIdx(idx + 1))} />

      <div className="absolute card p-4 flex flex-col gap-2.5 animate-fade-in" style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] text-text3">
            {idx + 1} / {steps.length}
          </span>
          <button onClick={finish} className="font-mono text-[11px] text-text3 hover:text-text2">
            skip tour
          </button>
        </div>
        <h3 className="text-sm font-semibold text-text tracking-tightish">{step.title}</h3>
        <p className="text-[13px] text-text2 leading-relaxed">{step.body}</p>
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={() => setIdx(Math.max(0, idx - 1))}
            disabled={idx === 0}
            className="btn btn-sm btn-ghost disabled:opacity-40"
          >
            ← back
          </button>
          <button onClick={() => (last ? finish() : setIdx(idx + 1))} className="btn btn-sm btn-primary">
            {last ? 'Done' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}
