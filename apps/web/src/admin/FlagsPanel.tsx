import { useState } from 'react';
import type { FlagDTO } from '@cadence/shared';
import { relativeTime } from '../lib/format';

export interface FlagsPanelProps {
  flags: FlagDTO[];
  onResolve: (id: string) => void;
  onDismiss: (id: string) => void;
  onAsk: (flag: FlagDTO, body: string) => void;
  onOpenUser?: (userId: string, iso?: string | null) => void;
}

const TYPE_LABEL: Record<FlagDTO['type'], string> = {
  open_no_activity: 'open · no activity',
  activity_no_session: 'activity · no session',
  long_open_session: 'long open session',
  overrun: 'overrun',
  duplicate_session: 'duplicate timers',
};

/** Tasteful tints per §9. danger for the hard problems, brass for time, muted for the soft one. */
const TYPE_CLASS: Record<FlagDTO['type'], string> = {
  open_no_activity: 'text-danger border-danger/40 bg-danger/10',
  activity_no_session: 'text-text2 border-hair2 bg-surface2',
  long_open_session: 'text-brass border-brass/40 bg-brass/10',
  overrun: 'text-brass border-brass/40 bg-brass/10',
  duplicate_session: 'text-brass border-brass/40 bg-brass/10',
};

function TypeBadge({ type }: { type: FlagDTO['type'] }) {
  return (
    <span className={`tag shrink-0 ${TYPE_CLASS[type]}`}>
      {TYPE_LABEL[type]}
    </span>
  );
}

function btn(extra: string): string {
  return `btn btn-sm ${extra}`;
}

function FlagRow({
  flag,
  onResolve,
  onDismiss,
  onAsk,
  onOpenUser,
}: {
  flag: FlagDTO;
  onResolve: (id: string) => void;
  onDismiss: (id: string) => void;
  onAsk: (flag: FlagDTO, body: string) => void;
  onOpenUser?: (userId: string, iso?: string | null) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [body, setBody] = useState('');
  const canAsk = flag.taskId != null;

  function send() {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    onAsk(flag, trimmed);
    setBody('');
    setAsking(false);
  }

  return (
    <li className="border-b border-hair last:border-b-0 px-4 sm:px-5 py-3.5 hover:bg-surface/25 transition-colors">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge type={flag.type} />
            {flag.userLogin ? (
              <button
                type="button"
                onClick={() => onOpenUser?.(flag.userId, flag.createdAt)}
                className="font-mono text-[11px] text-text2 hover:text-brass hover:underline"
                title="open their day"
              >
                @{flag.userLogin}
              </button>
            ) : null}
            <span className="font-mono text-[11px] text-text3">{relativeTime(flag.createdAt)}</span>
          </div>
          {flag.taskTitle ? (
            <button
              type="button"
              onClick={() => onOpenUser?.(flag.userId, flag.createdAt)}
              className="font-mono text-[11px] text-text3 truncate text-left hover:text-brass"
              title="open their day"
            >
              {flag.taskOrigin ? `${flag.taskOrigin} · ` : ''}
              <span className="text-text2">{flag.taskTitle}</span>
              {flag.repoFullName ? ` · ${flag.repoFullName}` : ''}
            </button>
          ) : null}
          <p className="text-sm text-text2 leading-relaxed break-words">{flag.detail}</p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => onResolve(flag.id)}
            className={btn('border-hair text-success hover:bg-surface')}
          >
            Resolve
          </button>
          <button
            type="button"
            onClick={() => onDismiss(flag.id)}
            className={btn('border-hair text-text3 hover:bg-surface')}
          >
            Dismiss
          </button>
          <button
            type="button"
            disabled={!canAsk}
            title={canAsk ? undefined : 'needs a task to ask about'}
            onClick={() => setAsking((v) => !v)}
            aria-expanded={asking}
            className={btn(
              canAsk
                ? 'border-hair text-brass hover:bg-surface'
                : 'border-hair text-text3 opacity-40 cursor-not-allowed',
            )}
          >
            Ask…
          </button>
        </div>
      </div>

      {asking && canAsk ? (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={body}
            autoFocus
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
              if (e.key === 'Escape') {
                setAsking(false);
                setBody('');
              }
            }}
            placeholder="Ask the dev about this flag…"
            className="field min-h-[32px] flex-1 px-3 font-mono text-sm"
          />
          <button
            type="button"
            onClick={send}
            disabled={body.trim().length === 0}
            className={btn(
              body.trim().length === 0
                ? 'border-hair text-text3 opacity-40 cursor-not-allowed'
                : 'border-brass/40 bg-brass/10 text-brass hover:bg-brass/20',
            )}
          >
            Send
          </button>
        </div>
      ) : null}
    </li>
  );
}

export default function FlagsPanel({ flags, onResolve, onDismiss, onAsk, onOpenUser }: FlagsPanelProps) {
  return (
    <section className="card overflow-hidden animate-fade-in">
      <header className="px-4 sm:px-5 py-3.5 border-b border-hair flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text tracking-tightish">Flags</h2>
        <span className="font-mono text-xs text-text3">{flags.length}</span>
      </header>

      {flags.length === 0 ? (
        <div className="px-4 py-14 flex flex-col items-center justify-center gap-3 text-center">
          <span className="w-9 h-9 rounded-full border border-success/30 bg-success/5 inline-flex items-center justify-center" aria-hidden>
            <span className="w-2 h-2 rounded-full bg-success" />
          </span>
          <span className="text-sm text-text3">No open flags</span>
        </div>
      ) : (
        <ul>
          {flags.map((f) => (
            <FlagRow
              key={f.id}
              flag={f}
              onResolve={onResolve}
              onDismiss={onDismiss}
              onAsk={onAsk}
              onOpenUser={onOpenUser}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
