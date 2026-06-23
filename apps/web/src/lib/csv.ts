import type { TeamDashboard } from '@cadence/shared';

function esc(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Trigger a client-side CSV download of the team rollup for the current range. */
export function downloadTeamCsv(data: TeamDashboard): void {
  const header = [
    'login',
    'name',
    'active_minutes',
    'task_hours_minutes',
    'sessions',
    'open_flags',
    'tasks_closed',
    'estimate_accuracy',
    'last_active',
    'running',
  ];
  const rows = data.members.map((m) =>
    [
      m.githubLogin,
      m.name ?? '',
      m.activeElapsedMinutes,
      m.taskHoursMinutes,
      m.sessionCount,
      m.openFlagCount,
      m.tasksClosed,
      m.estimateAccuracy ?? '',
      m.lastActiveAt ?? '',
      m.runningTaskTitles.join('; '),
    ]
      .map(esc)
      .join(','),
  );
  const csv = [header.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cadence-team-${data.rangeStart.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
