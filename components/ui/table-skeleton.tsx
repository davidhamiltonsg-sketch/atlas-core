// Shimmer placeholder rows shown while a table's data is being refreshed. Reuses the
// existing `.skeleton` shimmer defined in globals.css (already wired into the app's
// prefers-reduced-motion handling) rather than Tailwind's animate-pulse, which isn't.
export function TableSkeleton({ rows = 5, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y divide-border" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-3 px-5 py-3.5">
          <div className="skeleton h-3.5 w-3.5 shrink-0" style={{ borderRadius: "999px" }} />
          {Array.from({ length: columns }).map((_, c) => (
            <div
              key={c}
              className="skeleton h-3"
              style={{ width: c === 0 ? "22%" : `${Math.max(8, 14 - c)}%`, borderRadius: 6 }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
