import { useState } from 'react';
import type { FlagDTO } from '@cadence/shared';
import { relativeTime } from '../lib/format';

export interface FlagsPanelProps {
  flags: FlagDTO[];
  onResolve: (id: string) => void;
  onDismiss: (id: string) => void;
  onAsk: (flag: FlagDTO, body: string) => void;
}

const TYPE_LABEL: Record<FlagDTO['type'], string> = {
  open_no_activity: 'open · no activity',
  activity_no_session: 'activity · no session',
  long_open_session: 'long open session',
  overrun: 'overrun',
};

/** Tasteful tints per §9. danger for the hard problems, brass for time, muted for the soft one. */
const TYPE_CLASS: Record<FlagDTO['type'], string> = {
  open_no_activity: 'text-danger border-danger/40 bg-danger/10',
  activity_no_session: 'text-text2 border-hair2 bg-surface2',
  long_open_session: 'text-brass border-brass/40 bg-brass/10',
  overrun: 'text-brass border-brass/40 bg-brass/10',
};

function TypeBadge({ type }: { type: FlagDTO['type'] }) {
  return (
    <span
      className={`shrink-0 inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${TYPE_CLASS[type]}`}
    >
      {TYPE_LABEL[type]}
    </span>
  );
}

function btn(extra: string): string {
  return `min-h-[32px] inline-flex items-center justify-center rounded border px-2.5 font-mono text-xs transition-colors focus:outline-none focus:border-hair2 ${extra}`;
}

function FlagRow({
  flag,
  onResolve,
  onDismiss,
  onAsk,
}: {
  flag: FlagDTO;
  onResolve: (id: string) => void;
  onDismiss: (id: string) => void;
  onAsk: (flag: FlagDTO, body: string) => void;
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
    <li className="border-b border-hair last:border-b-0 px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge type={flag.type} />
            <span className="font-mono text-[11px] text-text3">{relativeTime(flag.createdAt)}</span>
          </div>
          <p className="text-sm text-text2 break-words">{flag.detail}</p>
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
            className="min-h-[32px] flex-1 rounded border border-hair bg-surface px-2.5 font-mono text-sm text-text placeholder:text-text3 focus:outline-none focus:border-hair2"
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

export default function FlagsPanel({ flags, onResolve, onDismiss, onAsk }: FlagsPanelProps) {
  return (
    <section className="rounded-lg border border-hair bg-panel overflow-hidden">
      <header className="px-4 py-3 border-b border-hair flex items-center justify-between">
        <h2 className="text-sm font-medium text-text">Flags</h2>
        <span className="font-mono text-xs text-text3">{flags.length}</span>
      </header>

      {flags.length === 0 ? (
        <div className="px-4 py-8 flex flex-col items-center justify-center gap-2 text-center">
          <span className="w-2 h-2 rounded-full bg-success" aria-hidden />
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
            />
          ))}
        </ul>
      )}
    </section>
  );
}
