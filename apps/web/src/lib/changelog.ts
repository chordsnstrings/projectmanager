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
