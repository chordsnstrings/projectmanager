import { useEffect, useState } from 'react';
import type { RepoLite, TaskDTO } from '@cadence/shared';
import { api, ApiError } from '../lib/api';

/**
 * Connect a manual task to git: create a new branch in a connected repo, or link
 * an existing one by typing its exact name (the server is idempotent — an
 * existing branch is linked rather than recreated). Self-contained: fetches the
 * repo list and posts, then asks the parent to refresh.
 */
export default function TaskGitConnect({ task, onConnected }: { task: TaskDTO; onConnected: () => void }) {
  const [repos, setRepos] = useState<RepoLite[] | null>(null);
  const [repoId, setRepoId] = useState('');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const linked = !!task.repoFullName;

  useEffect(() => {
    if (linked) return;
    let alive = true;
    void api<RepoLite[]>('/repos')
      .then((r) => alive && setRepos(r))
      .catch(() => alive && setRepos([]));
    return () => {
      alive = false;
    };
  }, [linked]);

  if (linked) {
    return (
      <div className="border-t border-hair pt-3 font-mono text-[11px] text-text2">
        git: <span className="text-brass">{task.repoFullName}</span>
        {task.branch ? <> · {task.branch}</> : null}
      </div>
    );
  }

  // Nothing to connect to (e.g. a team with no repos wired in) — stay out of the way.
  if (!repos || repos.length === 0) return null;

  const connect = async () => {
    if (!repoId || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/tasks/${task.id}/git`, {
        method: 'POST',
        body: JSON.stringify({ repoId, branch: branch.trim() || undefined }),
      });
      onConnected();
    } catch (e) {
      const code = e instanceof ApiError ? (e.body as { error?: string } | undefined)?.error : undefined;
      setErr(
        code === 'no_github_token'
          ? 'Sign in again to link git.'
          : 'Could not connect — check your access to the repo.',
      );
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-hair pt-3 flex flex-col gap-1.5">
      <span className="label">connect git</span>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={repoId}
          onChange={(e) => setRepoId(e.target.value)}
          className="field h-9 px-2.5 text-xs font-mono min-w-[12rem] [color-scheme:dark]"
        >
          <option value="">— pick a repo —</option>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.fullName}
            </option>
          ))}
        </select>
        <input
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="branch (new or existing)"
          className="field h-9 px-2.5 text-xs font-mono w-48"
        />
        <button type="button" onClick={connect} disabled={!repoId || busy} className="btn btn-sm btn-ghost">
          {busy ? 'connecting…' : 'Connect'}
        </button>
      </div>
      <span className="font-mono text-[10px] text-text3">
        Leave the branch blank to auto-name a new one, or type an existing branch to link it.
      </span>
      {err && <span className="font-mono text-[11px] text-danger">{err}</span>}
    </div>
  );
}
