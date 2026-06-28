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
