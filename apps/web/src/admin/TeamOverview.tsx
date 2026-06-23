import type { TeamDashboard, TeamMemberRollup } from '@cadence/shared';
import { fmtClock, fmtDuration, relativeTime } from '../lib/format';

export interface TeamOverviewProps {
  data: TeamDashboard;
  onSelectUser?: (userId: string) => void;
}

const noop = () => {};

function Avatar({ member }: { member: TeamMemberRollup }) {
  if (member.avatarUrl) {
    return (
      <img
        src={member.avatarUrl}
        alt=""
        className="w-6 h-6 rounded-full border border-hair shrink-0"
      />
    );
  }
  const initial = (member.name ?? member.githubLogin).slice(0, 1).toUpperCase();
  return (
    <span className="w-6 h-6 rounded-full border border-hair2 bg-surface2 inline-flex items-center justify-center text-[11px] text-text2 shrink-0">
      {initial}
    </span>
  );
}

/** estimateAccuracy → "1.3×" or "—". */
function fmtAccuracy(ratio: number | null): string {
  if (ratio == null) return '—';
  return `${ratio.toFixed(1)}×`;
}

function Stat({
  label,
  children,
  tone = 'text-text2',
}: {
  label: string;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[10px] uppercase tracking-wide text-text3">
        {label}
      </span>
      <span className={`font-mono text-sm ${tone}`}>{children}</span>
    </div>
  );
}

export default function TeamOverview({ data, onSelectUser = noop }: TeamOverviewProps) {
  return (
    <section className="rounded-lg border border-hair bg-panel overflow-hidden">
      <header className="px-4 py-3 border-b border-hair flex items-center justify-between">
        <h2 className="text-sm font-medium text-text">Team</h2>
        <span className="font-mono text-xs text-text3">
          {fmtClock(data.rangeStart)}–{fmtClock(data.rangeEnd)}
        </span>
      </header>

      <div role="table" aria-label="team overview">
        {data.members.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text3">No activity in range.</div>
        ) : (
          data.members.map((m) => (
            <button
              key={m.userId}
              type="button"
              onClick={() => onSelectUser(m.userId)}
              className="w-full text-left border-b border-hair last:border-b-0 px-4 py-3 hover:bg-surface/50 focus:outline-none focus:bg-surface/50"
            >
              <div className="flex items-center gap-3">
                <Avatar member={m} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm text-text font-medium truncate">
                      {m.name ?? m.githubLogin}
                    </span>
                    <span className="font-mono text-xs text-text3 truncate">
                      {m.githubLogin}
                    </span>
                  </div>
                  {m.runningTaskTitles.length > 0 ? (
                    <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-success shrink-0 animate-pulse"
                        aria-hidden
                      />
                      <span className="text-xs text-text2 truncate">
                        {m.runningTaskTitles.join(' · ')}
                      </span>
                    </div>
                  ) : (
                    <div className="mt-0.5 font-mono text-[11px] text-text3">
                      idle · last active {m.lastActiveAt ? relativeTime(m.lastActiveAt) : '—'}
                    </div>
                  )}
                </div>

                <div className="hidden sm:grid grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-1 shrink-0">
                  <Stat label="active">{fmtDuration(m.activeElapsedMinutes)}</Stat>
                  <Stat label="task hrs">{fmtDuration(m.taskHoursMinutes)}</Stat>
                  <Stat label="sessions">{m.sessionCount}</Stat>
                  <Stat
                    label="flags"
                    tone={m.openFlagCount > 0 ? 'text-danger' : 'text-text3'}
                  >
                    {m.openFlagCount}
                  </Stat>
                  <Stat label="closed">{m.tasksClosed}</Stat>
                  <Stat label="est acc">{fmtAccuracy(m.estimateAccuracy)}</Stat>
                </div>
              </div>

              {/* Mobile: same metrics as a compact wrapped strip (the grid above is hidden) */}
              <div className="sm:hidden mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-text2 pl-9">
                <span>active <span className="text-text">{fmtDuration(m.activeElapsedMinutes)}</span></span>
                <span>task <span className="text-text">{fmtDuration(m.taskHoursMinutes)}</span></span>
                <span>sess <span className="text-text">{m.sessionCount}</span></span>
                <span className={m.openFlagCount > 0 ? 'text-danger' : ''}>flags <span className={m.openFlagCount > 0 ? 'text-danger' : 'text-text'}>{m.openFlagCount}</span></span>
                <span>closed <span className="text-text">{m.tasksClosed}</span></span>
                <span>acc <span className="text-text">{fmtAccuracy(m.estimateAccuracy)}</span></span>
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
