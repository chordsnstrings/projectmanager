import type { MeetingDTO } from '@cadence/shared';

function whenLabel(iso: string): { text: string; soon: boolean; live: boolean } {
  const start = new Date(iso).getTime();
  const diffMin = Math.round((start - Date.now()) / 60_000);
  if (diffMin <= 0 && diffMin > -120) return { text: 'now', soon: true, live: true };
  if (diffMin < 60) return { text: `in ${diffMin}m`, soon: diffMin <= 15, live: false };
  const d = new Date(iso);
  return { text: d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }), soon: false, live: false };
}

/** The caller's upcoming meetings; "start" kicks off a meeting session (→ MoM). */
export default function UpcomingMeetings({
  meetings,
  onStartMeeting,
}: {
  meetings: MeetingDTO[];
  onStartMeeting: (title: string) => void;
}) {
  if (meetings.length === 0) return null;
  return (
    <section className="card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-hair label">upcoming meetings · {meetings.length}</div>
      <ul>
        {meetings.map((m) => {
          const w = whenLabel(m.scheduledAt);
          return (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3 border-b border-hair last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-text truncate tracking-tightish">{m.title}</div>
                <div className="font-mono text-[10px] text-text3 mt-0.5 truncate">
                  {new Date(m.scheduledAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  {m.location ? ` · ${m.location}` : ''}
                  {m.attendees.length ? ` · ${m.attendees.length} invited` : ''}
                </div>
              </div>
              <span className={`font-mono text-[11px] shrink-0 ${w.soon ? 'text-brass' : 'text-text3'}`}>{w.text}</span>
              {w.soon && (
                <button
                  type="button"
                  onClick={() => onStartMeeting(m.title)}
                  className="btn btn-sm btn-primary shrink-0"
                  title="start a meeting session for this — minutes required to end"
                >
                  start
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
