import { useEffect, useState } from 'react';
import type { Me, TeamDTO } from '@cadence/shared';
import { TEAM_ACTIVITIES } from './lib/activity';
import { api } from './lib/api';
import { Logo } from './components/Logo';

/** First-run team picker. Sets the user's team, then hands back the fresh Me. */
export default function Onboarding({ onDone }: { onDone: (me: Me) => void }) {
  const [teams, setTeams] = useState<TeamDTO[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void api<TeamDTO[]>('/teams')
      .then(setTeams)
      .catch(() => setTeams([]));
  }, []);

  const pick = async (key: string) => {
    if (busy) return;
    setBusy(key);
    try {
      const me = await api<Me>('/me/team', { method: 'PATCH', body: JSON.stringify({ teamKey: key }) });
      onDone(me);
    } catch {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-full text-text font-sans overflow-x-hidden">
      <div className="min-h-screen grid place-items-center p-6">
        <div className="card p-8 sm:p-10 max-w-md w-full animate-fade-in">
          <div className="mb-5 flex justify-center">
            <Logo size={30} />
          </div>
          <h1 className="text-center text-sm font-semibold text-text tracking-tightish">Which team are you on?</h1>
          <p className="text-text3 text-xs text-center mt-1.5 mb-6 max-w-[34ch] mx-auto">
            This sets your activity types and where your work shows up. An admin can change it later.
          </p>

          {teams === null ? (
            <div className="text-center font-mono text-xs text-text3 py-6">loading…</div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {teams.map((t) => {
                const acts = TEAM_ACTIVITIES[t.key]?.activities ?? [];
                return (
                  <button
                    key={t.id}
                    onClick={() => pick(t.key)}
                    disabled={!!busy}
                    className="card-i p-4 text-left flex items-center gap-3 disabled:opacity-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-text">{t.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {acts.map((a) => (
                          <span key={a.key} className="inline-flex items-center gap-1 font-mono text-[10px] text-text3">
                            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: a.color }} aria-hidden />
                            {a.label}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className="font-mono text-xs text-text3 shrink-0">{busy === t.key ? '…' : '→'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
