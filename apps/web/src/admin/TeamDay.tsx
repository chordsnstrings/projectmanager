import type { TeamDay as TeamDayDTO, TeamDayMember, TeamDaySession } from '@cadence/shared';
import { ACTIVITY_COLORS } from '../lib/activity';
import { fmtClock, fmtDuration } from '../lib/format';
import { barGeom, hourTicks, makeWindow, type TimeWindow } from './timeScale';

export interface TeamDayProps {
  data: TeamDayDTO;
  onSelectUser: (userId: string) => void;
}

function Bars({ sessions, w, tz }: { sessions: TeamDaySession[]; w: TimeWindow; tz: string }) {
  return (
    <div className="relative h-6">
      {sessions.map((s) => {
        const { left, width } = barGeom(s.startedAt, s.endedAt, w);
        return (
          <div
            key={s.id}
            className={`absolute top-0 bottom-0 rounded-md overflow-hidden border ${
              s.isOpen ? 'border-success/50' : 'border-hair2'
            } bg-surface`}
            style={{ left: `${left}%`, width: `${width}%` }}
            title={`${s.title} · ${fmtClock(s.startedAt, tz)}–${s.endedAt ? fmtClock(s.endedAt, tz) : 'now'}`}
          >
            {s.segments.map((seg, i) => {
              const g = barGeom(seg.startedAt, seg.endedAt, w);
              const relLeft = ((g.left - left) / width) * 100;
              const relWidth = (g.width / width) * 100;
              return (
                <span
                  key={`${seg.startedAt}-${i}`}
                  className="absolute top-0 bottom-0"
                  style={{
                    left: `${Math.max(0, relLeft)}%`,
                    width: `${Math.max(0.5, relWidth)}%`,
                    backgroundColor: ACTIVITY_COLORS[seg.type],
                    opacity: seg.source === 'manual' ? 1 : 0.85,
                  }}
                />
              );
            })}
            {s.isOpen && <span className="absolute right-0 top-0 bottom-0 w-0.5 bg-success" aria-hidden />}
          </div>
        );
      })}
    </div>
  );
}

function MemberRow({
  m,
  w,
  tz,
  onSelect,
}: {
  m: TeamDayMember;
  w: TimeWindow;
  tz: string;
  onSelect: (userId: string) => void;
}) {
  const ticks = hourTicks(w, tz);
  return (
    <div className="flex items-stretch border-b border-hair last:border-b-0 hover:bg-surface/20 transition-colors">
      <button
        type="button"
        onClick={() => onSelect(m.userId)}
        title="open this person’s day"
        className="w-40 sm:w-52 shrink-0 px-4 py-3 border-r border-hair text-left cursor-pointer hover:bg-surface/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brass/50"
      >
        <div className="flex items-center gap-2">
          {m.avatarUrl ? (
            <img src={m.avatarUrl} alt="" className="w-5 h-5 rounded-full" />
          ) : (
            <span className="w-5 h-5 rounded-full bg-surface2 inline-block" aria-hidden />
          )}
          <span className="text-sm text-text truncate tracking-tightish">{m.githubLogin}</span>
        </div>
        <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-text3 flex-wrap">
          <span>{fmtDuration(m.activeElapsedMinutes)}</span>
          <span>· {m.sessionCount} sess</span>
          {m.openFlagCount > 0 && <span className="text-danger">· {m.openFlagCount} flag</span>}
          {m.runningTitles.length > 0 && (
            <span className="inline-flex items-center gap-1 text-success">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" aria-hidden />live
            </span>
          )}
        </div>
      </button>

      <div className="relative flex-1 min-w-0 py-3.5 px-2">
        {ticks.map((t) => (
          <span
            key={t.left}
            className="absolute top-0 bottom-0 w-px bg-hair"
            style={{ left: `${t.left}%` }}
            aria-hidden
          />
        ))}
        {m.sessions.length === 0 ? (
          <div className="h-6 flex items-center font-mono text-[11px] text-text3">—</div>
        ) : (
          <Bars sessions={m.sessions} w={w} tz={tz} />
        )}
      </div>
    </div>
  );
}

/** The whole team's day on one shared wall-clock axis — one row per member. */
export default function TeamDay({ data, onSelectUser }: TeamDayProps) {
  const tz = data.timezone;
  const w = makeWindow(data.dayStart, data.dayEnd);
  const ticks = hourTicks(w, tz);
  const active = data.members.filter((m) => m.sessionCount > 0).length;

  return (
    <section className="card overflow-hidden animate-fade-in">
      <header className="px-4 sm:px-5 py-3.5 border-b border-hair flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-text tracking-tightish">Team day</h2>
          <span className="font-mono text-xs text-text3">
            {data.date} · {tz} · {active}/{data.members.length} active
          </span>
        </div>
      </header>

      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          {/* Axis */}
          <div className="flex items-stretch border-b border-hair bg-bg/40">
            <div className="w-40 sm:w-52 shrink-0 border-r border-hair px-4 py-2">
              <span className="label">member</span>
            </div>
            <div className="relative flex-1 min-w-0 py-1.5 px-2 h-7">
              {ticks.map((t) => (
                <span
                  key={t.left}
                  className="absolute top-1 font-mono text-[10px] text-text3 -translate-x-1/2"
                  style={{ left: `${t.left}%` }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>

          {data.members.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-text3">No members.</div>
          ) : (
            data.members.map((m) => (
              <MemberRow key={m.userId} m={m} w={w} tz={tz} onSelect={onSelectUser} />
            ))
          )}
        </div>
      </div>

      <footer className="px-4 sm:px-5 py-2.5 border-t border-hair flex items-center gap-4 flex-wrap font-mono text-[10px] text-text3">
        {(['coding', 'debugging', 'research', 'agent', 'review'] as const).map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: ACTIVITY_COLORS[t] }} aria-hidden />
            {t}
          </span>
        ))}
      </footer>
    </section>
  );
}
