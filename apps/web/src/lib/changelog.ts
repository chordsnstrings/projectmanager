// What's-new changelog. Newest entry first. Bump the top entry's `version`
// (and add a new object) whenever there's something worth telling users about —
// the update modal shows every entry newer than what each user last acknowledged.
export interface ChangelogEntry {
  version: string;
  date: string; // YYYY-MM-DD
  title: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '2.0.5',
    date: '2026-07-14',
    title: 'Your board only asks your own questions',
    items: [
      'Fixed the work board showing managers questions they had raised for other people as if they needed answering — it now shows only questions actually addressed to you.',
    ],
  },
  {
    version: '2.0.4',
    date: '2026-07-14',
    title: 'Admins & leads can track their own work',
    items: [
      'Managers now have a “My work” board of their own — start and stop your own sessions just like anyone on the team, then hop back to the dashboard.',
    ],
  },
  {
    version: '2.0.3',
    date: '2026-07-14',
    title: 'Stop idle sessions from a flag',
    items: [
      'An idle or long-open session flag now has a “Stop session” button — end the stray timer in one tap and the flag clears itself.',
      'Team leads can now stop a running session for anyone on their team (not just admins).',
    ],
  },
  {
    version: '2.0.2',
    date: '2026-07-14',
    title: 'Ending a meeting',
    items: [
      'Stopping a meeting now always opens the Minutes of Meeting form to fill in — no more error message with nowhere to save.',
      'Started a meeting by mistake? The minutes form now has a “discard — started by mistake” option that ends it without minutes and keeps it out of tracked time.',
    ],
  },
  {
    version: '2.0.1',
    date: '2026-07-14',
    title: 'Always stoppable',
    items: [
      'New “Running now” bar at the top of your board — stop any running task in one tap, even if its row is scrolled away or covered.',
      'Fixed the phone keyboard’s autofill suggestions covering the task list.',
    ],
  },
  {
    version: '2.0',
    date: '2026-07-08',
    title: 'Schedule meetings',
    items: [
      'Managers can schedule a meeting for specific people at a future time (with agenda, duration and a room/link) from the new Meetings tab.',
      'Invitees see it on their board with a countdown, get notified, and can start it in one tap when it’s time — which flows straight into the minutes form.',
      'Scheduled meetings now appear as planned blocks on each attendee’s day timeline, at their booked time.',
      'Reminders go out ~15 minutes before a meeting — by email as well as push.',
    ],
  },
  {
    version: '1.9',
    date: '2026-07-08',
    title: 'Meeting minutes → action items',
    items: [
      'Ending a meeting now opens a Minutes of Meeting form — date, members, agenda, and a row per topic (details, decision, responsible, timeline, remarks). The meeting only ends once it’s filled in.',
      'Open a meeting on the day timeline to review the minutes, export them as a Word document, or turn any action item into a trackable task with one tap.',
      'Mark your own tasks complete right from the board — so those action items can be closed out on the day.',
    ],
  },
  {
    version: '1.8.1',
    date: '2026-07-06',
    title: 'Ask about any session',
    items: [
      'Managers can now raise a question on any session — including off-task work (study, review, pairing) that has no task. Click the session bar, then "ask…".',
    ],
  },
  {
    version: '1.8',
    date: '2026-07-05',
    title: 'A smoother Cadence',
    items: [
      'Long lists load in pages everywhere — "show more" on tasks and flags instead of silently cutting off at 50.',
      'Clear feedback on every action: error toasts when something fails, and busy states on play/stop, pick up, save and answer.',
      'Nicer dialogs replace browser popups; Escape closes overlays and the page behind no longer scrolls.',
      'Faster feel: skeleton loading screens, instant data refresh when you return to the tab, and scroll-to-top on navigation.',
      'Keyboard: ←/→ steps through days on timeline views; Enter saves your wrap-up summary.',
      'Mobile: tidier top bar, Pulse table scrolls sideways, press feedback on chips — and admin drill-downs keep your date and team filter.',
    ],
  },
  {
    version: '1.7',
    date: '2026-07-02',
    title: 'A guided walkthrough',
    items: [
      'New interactive walkthrough that tours the actual screens — it runs once on your first visit, and you can replay it any time from the ? guide.',
    ],
  },
  {
    version: '1.6',
    date: '2026-06-28',
    title: 'Connect git to your tasks & a built-in guide',
    items: [
      'Connect a manually-created task to git right from your board — create a new branch or link an existing one by name.',
      'New “How Cadence works” guide — tap the ? in the top bar for a walkthrough of the system and flow, tailored to your role and team.',
    ],
  },
  {
    version: '1.5',
    date: '2026-06-28',
    title: 'Push notifications',
    items: [
      'Turn on notifications (the 🔔 in the top bar) to get pinged about questions, flags on your work, task assignments, approved plans, and new comments — even when Cadence is closed.',
      'Works on the installed app and supported browsers; enable per device.',
    ],
  },
  {
    version: '1.4',
    date: '2026-06-25',
    title: 'Start your day with a check-in',
    items: [
      'Morning check-in: rate yesterday, set where each open task stands, name your biggest blocker, and pick today’s focus.',
      'New admin Pulse tab — felt-vs-measured per member, sentiment trend, blocker breakdown, and live carry-over.',
      'Picking up detected work now asks what you’re working on, just like the play button.',
      'Task discussions are now visible to your whole team — read the brief + previous comments on a pool task before you pick it up.',
    ],
  },
  {
    version: '1.3',
    date: '2026-06-25',
    title: 'Teams, clarity & a shared task pool',
    items: [
      'Marketing & Programming teams — pick your team at sign-in; each team has its own activity types.',
      'Task pool: pick up open tasks for your team, or add your own in one tap.',
      'Questions & flags now show which task (and who) they’re about — and link straight to that day.',
      'Archive tasks you no longer need.',
      'Install Cadence as an app from your browser (Add to Home Screen).',
    ],
  },
];

/** The version users are notified about — the newest changelog entry. */
export const APP_VERSION = CHANGELOG[0]?.version ?? '0';

/** Entries newer than the version a user last acknowledged (for the modal). */
export function entriesSince(seen: string | null): ChangelogEntry[] {
  if (!seen) return CHANGELOG.length ? [CHANGELOG[0]!] : [];
  const idx = CHANGELOG.findIndex((e) => e.version === seen);
  if (idx === -1) return CHANGELOG.length ? [CHANGELOG[0]!] : []; // unknown/old → just the latest
  return CHANGELOG.slice(0, idx); // entries newer than `seen`
}
