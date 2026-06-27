// Branded loading splash — shown while a page's live data (prices, holdings) loads,
// so the user sees Atlas Core before the dashboard paints. Calm, but clearly moving.
export default function Loading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
      style={{ background: "radial-gradient(120% 120% at 50% 0%, hsl(240 27% 9%) 0%, hsl(240 27% 5%) 60%)" }}>

      {/* soft ambient glows */}
      <div className="pointer-events-none absolute -top-1/4 left-1/2 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(124,58,237,0.45), transparent 60%)" }} />

      <div className="relative flex flex-col items-center gap-7">
        {/* Mark + spinning gradient ring */}
        <div className="relative float-soft">
          {/* rotating conic ring */}
          <div
            className="absolute -inset-3 rounded-[1.5rem] animate-spin"
            style={{
              animationDuration: "2.8s",
              background: "conic-gradient(from 0deg, transparent 0%, #6366f1 20%, #a78bfa 45%, #22d3ee 60%, transparent 80%)",
              WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
              mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
            }}
          />
          {/* AC mark */}
          <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-2xl shadow-indigo-500/40">
            <span className="text-2xl font-black tracking-tight text-white">AC</span>
            <div className="absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/20" />
          </div>
        </div>

        {/* Wordmark */}
        <div className="text-center">
          <p className="text-lg font-bold tracking-tight text-white">Atlas Core</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-[0.25em] text-indigo-300/70">Investment Operating System</p>
        </div>

        {/* Moving progress bar */}
        <div className="h-1 w-44 overflow-hidden rounded-full bg-white/10">
          <div className="loadbar h-full w-1/3 rounded-full bg-gradient-to-r from-indigo-400 via-violet-400 to-cyan-400" />
        </div>

        <p className="text-[11px] text-slate-400/80">Loading your portfolio…</p>
      </div>
    </div>
  )
}
