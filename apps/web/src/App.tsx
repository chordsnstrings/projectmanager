import { useEffect, useState } from 'react';
import type { HealthStatus, Me } from '@cadence/shared';
import { api, ApiError } from './lib/api';

type AuthState = { kind: 'loading' } | { kind: 'anon' } | { kind: 'authed'; me: Me };

export default function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' });

  useEffect(() => {
    api<HealthStatus>('/healthz')
      .then(setHealth)
      .catch(() => setHealth(null));

    api<Me>('/me')
      .then((me) => setAuth({ kind: 'authed', me }))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setAuth({ kind: 'anon' });
        else setAuth({ kind: 'anon' });
      });
  }, []);

  return (
    <div className="min-h-full bg-bg text-text font-sans">
      <header className="border-b border-hair px-6 py-4 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className="text-[15px] font-semibold tracking-tight">cadence</span>
          <span className="text-text3 font-mono text-xs">engineering instrument</span>
        </div>
        <span className="font-mono text-xs text-text2">
          {health ? (
            <span className="text-success">● healthy</span>
          ) : (
            <span className="text-danger">● unreachable</span>
          )}
        </span>
      </header>

      <main className="px-6 py-10 max-w-3xl mx-auto">
        <div className="rounded-lg border border-hair bg-panel p-6">
          <h1 className="text-sm font-medium mb-1">Phase 0 — skeleton online</h1>
          <p className="text-text2 text-sm mb-5">
            The monorepo, API, and SPA shell are wired. Auth, sessions, and the dashboards
            land in later phases.
          </p>

          <dl className="font-mono text-xs space-y-2">
            <Row label="server">
              {health ? `ok · ${new Date(health.time).toLocaleTimeString()}` : '—'}
            </Row>
            <Row label="session">
              {auth.kind === 'loading'
                ? 'checking…'
                : auth.kind === 'authed'
                  ? `${auth.me.githubLogin} (${auth.me.role})`
                  : 'signed out'}
            </Row>
          </dl>
        </div>
      </main>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <dt className="text-text3 w-20">{label}</dt>
      <dd className="text-text">{children}</dd>
    </div>
  );
}
