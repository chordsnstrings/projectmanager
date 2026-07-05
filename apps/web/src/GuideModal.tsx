import { useEffect, useState } from 'react';
import type { Me } from '@cadence/shared';
import { Logo } from './components/Logo';
import { TEAM_ACTIVITIES } from './lib/activity';
import { startTour } from './Walkthrough';
import { useEscape, useLockBodyScroll } from './lib/useModal';

/**
 * "How Cadence works" — an in-app guide to the system and flow, tailored to the
 * viewer's role (member vs lead/admin) and team (activity set, git inference).
 * Mounted once at the App root; any header can open it via openGuide().
 */
export function openGuide(): void {
  window.dispatchEvent(new CustomEvent('open-guide'));
}

/** The ? chip that opens the guide (drop into any header). */
export function GuideButton() {
  return (
    <button
      data-tour="guide"
      onClick={openGuide}
      className="btn btn-sm btn-ghost"
      title="How Cadence works"
      aria-label="How Cadence works"
    >
      ?
    </button>
  );
}

interface Section {
  title: string;
  intro?: string;
  items: string[];
}

function memberSections(teamKey: string | null): Section[] {
  const git = teamKey !== 'marketing';
  return [
    {
      title: 'The model',
      intro: 'Three things, one loop:',
      items: [
        'A task is a unit of work — synced from GitHub (issues, PRs, branches) or created in Cadence by you or a manager.',
        'A session is the clock. Press play when you start working on a task, stop when you step away. Sessions are the only measure of your time — no session, no recorded work.',
        git
          ? 'Git is the truth. Commits, PRs and reviews are matched against your sessions; Cadence compares what you declared with what actually landed.'
          : 'Your work is tagged by activity (one tap) — committable output like designs or videos can also be linked to a repo when that fits.',
      ],
    },
    {
      title: 'Your day, start to finish',
      items: [
        'Morning check-in: rate yesterday, mark where each open task stands (on track / blocked / dropping), name your biggest blocker, pick today’s focus. Skippable — but it’s how you and your manager both see trends.',
        'Press play on a task and say what you’re about to do (one line, 300 chars). That intent shows up on your timeline.',
        `While running, the coloured edge shows your current activity (${(TEAM_ACTIVITIES[teamKey ?? ''] ?? TEAM_ACTIVITIES.programming!).activities.map((a) => a.label).join(' · ')}). ${git ? 'It’s inferred from your commits — tap it to correct it.' : 'Tap it to set what you’re doing.'}`,
        git
          ? 'Press stop when you finish — a one-line summary is auto-drafted from your commits; edit it if it’s off. You can also auto-stop the session when a commit lands (toggle at the bottom of the board).'
          : 'Press stop when you finish and leave a one-line summary of what you produced.',
        'Off-task work (meetings, research without a task) gets its own labelled session — or backfill a block you forgot.',
      ],
    },
    {
      title: 'Tasks: pool, briefs and steps',
      items: [
        'The pool lists unassigned tasks for your team — expand one to read the brief and discussion, then pick it up.',
        'Every task can carry a brief (what’s wanted), an approved step-by-step, and a discussion thread the whole team can read and join.',
        'You can create tasks for yourself or drop them into the pool.',
        ...(git
          ? ['A manual task can be connected to git — create a fresh branch or link an existing one — so your commits count toward it.']
          : []),
      ],
    },
    {
      title: 'Flags & questions',
      items: [
        'Flags are automatic observations, not accusations: an open task with no activity, work landing with no session running, a session left open too long, an overrun vs estimate. They never block you — they’re prompts to keep the record honest.',
        'Questions are different: a manager can ask you a question on a task, and a blocking question gates completing your next task until you answer. Answer from the board.',
      ],
    },
    {
      title: 'Staying in the loop',
      items: [
        'Enable notifications (the 🔔 up top) to get pinged about questions, flags, assignments, approved steps and comments — even when Cadence is closed.',
        'Install Cadence as an app (Add to Home Screen) for the best experience on your phone.',
        'My day shows your own timeline; Progress shows your trend lines. What managers see of you is exactly this same data.',
      ],
    },
  ];
}

function managerSections(role: string): Section[] {
  return [
    {
      title: 'The model',
      intro: 'Cadence surfaces the diff between declared work and observed work:',
      items: [
        'Sessions are the clock — each member starts/stops a timer against a task, with a one-line intent.',
        'Git is the truth — commits, PRs and reviews are ingested and matched to tasks and sessions.',
        'Flags are the diff — where the story and the evidence disagree, a flag is raised for you to review.',
        role === 'lead'
          ? 'As a lead you see your own team; the owner sees every team.'
          : 'As the owner you see every team — use the team filter to scope any view.',
      ],
    },
    {
      title: 'People & timelines',
      items: [
        'People: live roster — who’s running a session right now (coloured edge = activity), today’s active time, estimates vs actuals.',
        'Click a person → their day timeline: every session, its intent, activity segments, commits and summaries. Switch to Trends or Progress for the longer arc.',
        'Team day shows everyone’s lanes side by side for one date.',
      ],
    },
    {
      title: 'Tasks: brief → steps → handoff',
      items: [
        'Create a task with a brief, assign an owner and collaborators, set an estimate.',
        'AI can draft a step-by-step plan from the brief; you edit and approve it — approval is the handoff signal the assignee sees.',
        'A readiness check scores whether the brief is specified enough before handoff or claim; you can always override.',
        'Tasks can be connected to git (new or existing branch) so commits attribute to them.',
      ],
    },
    {
      title: 'Flags, questions & the gate',
      items: [
        'Flags land in the Flags tab: resolve them, dismiss them, or turn one into a question in a tap.',
        'A blocking question gates the member’s next task completion until answered — use it when you genuinely need the answer, not as a nudge.',
        'Everything links back to the person’s day so you judge with context, not just the flag text.',
      ],
    },
    {
      title: 'Pulse: how the team is doing',
      items: [
        'Every member starts their day with a check-in (self-rating, blockers, focus, per-task carry-over).',
        'Pulse shows felt-vs-measured per member (a positive gap = feels better than output; negative = output beats how they feel), the weekly sentiment trend, a blocker breakdown, and live carry-over.',
        'Use it to spot quiet strugglers and systemic blockers — not to rank people.',
      ],
    },
  ];
}

export default function GuideModal({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener('open-guide', h);
    return () => window.removeEventListener('open-guide', h);
  }, []);
  useEscape(() => setOpen(false), open);
  useLockBodyScroll(open);

  if (!open) return null;
  const isManager = me.role === 'admin' || me.role === 'lead';
  const sections = isManager ? managerSections(me.role) : memberSections(me.teamKey);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card w-full max-w-2xl p-6 sm:p-7 flex flex-col gap-4 max-h-[88vh] animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3">
          <Logo size={24} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text tracking-tightish">How Cadence works</h2>
            <p className="font-mono text-[11px] text-text3">
              {isManager ? (me.role === 'lead' ? 'for leads' : 'for the owner') : `for ${me.teamKey ?? 'team'} members`}
            </p>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="ml-auto text-text3 hover:text-text2 text-lg leading-none"
            aria-label="close"
          >
            ×
          </button>
        </header>

        <div className="flex flex-col gap-5 overflow-y-auto pr-1">
          <p className="text-[13px] text-text2 leading-relaxed">
            Sessions are the clock. Git is the truth. Cadence exists to give everyone — you included —
            an honest, granular picture of where the time goes.
          </p>
          {sections.map((s, i) => (
            <section key={s.title} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="grid place-items-center w-4 h-4 rounded-full bg-surface2 font-mono text-[10px] text-text3 shrink-0">
                  {i + 1}
                </span>
                <h3 className="text-[13px] font-medium text-text">{s.title}</h3>
              </div>
              {s.intro && <p className="text-[13px] text-text2 pl-6">{s.intro}</p>}
              <ul className="flex flex-col gap-1.5 pl-6">
                {s.items.map((item, j) => (
                  <li key={j} className="flex gap-2 text-[13px] text-text2 leading-relaxed">
                    <span className="text-brass shrink-0">·</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="flex items-center justify-between gap-3 pt-1 border-t border-hair">
          <button
            onClick={() => {
              setOpen(false);
              startTour();
            }}
            className="btn btn-md btn-ghost"
          >
            ▶ take the walkthrough
          </button>
          <button onClick={() => setOpen(false)} className="btn btn-md btn-primary">
            Got it
          </button>
        </footer>
      </div>
    </div>
  );
}
