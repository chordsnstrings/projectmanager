/** Shimmering placeholders shown while first data loads — the layout appears
 *  instantly instead of a blank splash, so navigation feels faster. */

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="card overflow-hidden animate-fade-in" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5 border-b border-hair last:border-b-0">
          <div className="shimmer w-6 h-6 rounded-full shrink-0" />
          <div className="flex-1 flex flex-col gap-1.5">
            <div className="shimmer h-3 rounded" style={{ width: `${55 - i * 7}%` }} />
            <div className="shimmer h-2 rounded" style={{ width: `${30 - i * 3}%` }} />
          </div>
          <div className="shimmer w-10 h-10 rounded-full shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** Full dev-board placeholder: productivity strip + task rows. */
export default function BoardSkeleton() {
  return (
    <div className="min-h-full" aria-label="loading" role="status">
      <div className="sticky top-0 z-20 border-b border-hair h-14" />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-7 sm:py-8 flex flex-col gap-5">
        <div className="card px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="shimmer h-2 w-16 rounded" />
              <div className="shimmer h-4 w-12 rounded" />
            </div>
          ))}
        </div>
        <ListSkeleton rows={4} />
      </main>
    </div>
  );
}
