// Web-local copy of the per-team activity registry. Kept here (not imported from
// @cadence/shared) because the shared package is built as CommonJS and the web
// bundle must not resolve runtime values out of it. Mirror of TEAM_ACTIVITIES in
// packages/shared/src/index.ts — keep the two in sync when adding a team.
export interface ActivityDef {
  key: string;
  label: string;
  color: string;
}

export const TEAM_ACTIVITIES: Record<string, { activities: ActivityDef[]; defaultActivity: string }> = {
  programming: {
    defaultActivity: 'coding',
    activities: [
      { key: 'coding', label: 'coding', color: '#2bb68c' },
      { key: 'debugging', label: 'debugging', color: '#f0a93b' },
      { key: 'research', label: 'research', color: '#4c9aea' },
      { key: 'agent', label: 'agent', color: '#9a8cf0' },
      { key: 'review', label: 'review', color: '#8a909b' },
    ],
  },
  marketing: {
    defaultActivity: 'design',
    activities: [
      { key: 'design', label: 'design', color: '#2bb68c' },
      { key: 'video', label: 'video', color: '#f0a93b' },
      { key: 'copywriting', label: 'copywriting', color: '#e0739a' },
      { key: 'research', label: 'research', color: '#4c9aea' },
      { key: 'ai', label: 'ai', color: '#9a8cf0' },
    ],
  },
};

/** Merged activity-key → colour map across every team's set. */
export const ACTIVITY_COLORS: Record<string, string> = Object.fromEntries(
  Object.values(TEAM_ACTIVITIES).flatMap((c) => c.activities.map((a) => [a.key, a.color])),
);

/** Valid activity keys for a team key (empty if unknown). */
export function activityKeysFor(teamKey: string | null | undefined): string[] {
  return teamKey && TEAM_ACTIVITIES[teamKey] ? TEAM_ACTIVITIES[teamKey].activities.map((a) => a.key) : [];
}
