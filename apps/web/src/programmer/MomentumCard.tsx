import type { MomentumBadge, MomentumDTO } from '@cadence/shared';
import { useCountUp } from '../lib/useCountUp';

/** Circular level ring with the level number in the middle. */
function LevelRing({ level, pct }: { level: number; pct: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative w-12 h-12 shrink-0" aria-hidden>
      <svg viewBox="0 0 44 44" className="w-12 h-12 -rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="3" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke="#c8a96a"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(1, pct)))}
          className="transition-[stroke-dashoffset] duration-700 ease-smooth"
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-mono text-sm font-semibold text-brass">
        {level}
      </span>
    </div>
  );
}

function BadgeChip({ badge }: { badge: MomentumBadge }) {
  const { earned, label, description, progress, goal } = badge;
  return (
    <div
      title={`${description}${earned ? ' · earned' : ` · ${progress}/${goal}`}`}
      className={`shrink-0 rounded-lg border px-2.5 py-1.5 flex flex-col gap-0.5 min-w-[86px] transition-transform active:scale-[.97] ${
        earned ? 'border-brass/40 bg-brass/10' : 'border-hair bg-surface/40 opacity-70'
      }`}
    >
      <span className={`text-[11px] font-medium leading-tight ${earned ? 'text-brass' : 'text-text3'}`}>
        <span aria-hidden>{earned ? '★' : '☆'}</span> {label}
      </span>
      <span className="font-mono text-[9px] text-text3">{earned ? 'earned' : `${progress}/${goal}`}</span>
    </div>
  );
}

/**
 * Personal momentum: level ring + XP-to-next bar, activity streak, and a
 * badges strip. Private to the signed-in dev — non-competitive by design.
 */
export default function MomentumCard({ momentum }: { momentum: MomentumDTO | null }) {
  const xp = useCountUp(momentum?.xp ?? 0);
  if (!momentum) return null;
  const pct = momentum.xpForLevel > 0 ? momentum.xpIntoLevel / momentum.xpForLevel : 0;
  // Show earned first, then those closest to completion — keeps it motivating.
  const badges = [...momentum.badges].sort((a, b) => {
    if (a.earned !== b.earned) return a.earned ? -1 : 1;
    return b.progress / b.goal - a.progress / a.goal;
  });

  return (
    <section className="card p-4 sm:p-5 flex flex-col gap-3.5 animate-fade-in">
      <div className="flex items-center gap-3">
        <LevelRing level={momentum.level} pct={pct} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text tracking-tightish">Momentum</span>
            <span className="font-mono text-[10px] text-text3 tabular-nums">{xp} xp</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-surface2 overflow-hidden">
            <div
              className="h-full bg-brass rounded-full transition-[width] duration-700 ease-smooth"
              style={{ width: `${Math.round(pct * 100)}%` }}
            />
          </div>
          <div className="mt-1 font-mono text-[10px] text-text3">
            {momentum.xpIntoLevel}/{momentum.xpForLevel} to level {momentum.level + 1}
          </div>
        </div>
        <div className="text-right shrink-0" title={`Best streak: ${momentum.bestStreakDays} days`}>
          <div className="font-mono text-sm text-text">
            <span aria-hidden>🔥</span> {momentum.streakDays}
            <span className="text-text3">d</span>
          </div>
          <div className="font-mono text-[10px] text-text3">best {momentum.bestStreakDays}</div>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {badges.map((b) => (
          <BadgeChip key={b.id} badge={b} />
        ))}
      </div>
    </section>
  );
}
