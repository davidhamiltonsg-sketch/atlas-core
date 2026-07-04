import { AtlasCoreMark } from "@/components/brand/brand-mark"

// Branded loading splash — shown while a page's live data (prices, holdings) loads,
// so the user sees the crest before the dashboard paints. Calm, but clearly moving.
export default function Loading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
      style={{ background: "radial-gradient(120% 120% at 50% 0%, hsl(259 34% 9%) 0%, hsl(259 34% 5%) 60%)" }}>

      {/* soft ambient glows */}
      <div className="pointer-events-none absolute -top-1/4 left-1/2 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(124,58,237,0.5), transparent 60%)" }} />

      <div className="relative flex flex-col items-center gap-7">
        {/* Crest + spinning gradient ring */}
        <div className="relative float-soft">
          {/* rotating conic ring */}
          <div
            className="absolute -inset-4 rounded-full animate-spin"
            style={{
              animationDuration: "2.8s",
              background: "conic-gradient(from 0deg, transparent 0%, #a78bfa 20%, #c084fc 45%, #e879f9 60%, transparent 80%)",
              WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
              mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
            }}
          />
          <AtlasCoreMark className="relative h-20 w-20 drop-shadow-[0_12px_30px_rgba(124,58,237,0.45)]" />
        </div>

        {/* Wordmark */}
        <div className="text-center">
          <p className="text-lg font-bold tracking-tight text-white">Atlas Core</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-[0.25em] text-violet-300/70">Investment Operating System</p>
        </div>

        {/* Moving progress bar */}
        <div className="h-1 w-44 overflow-hidden rounded-full bg-white/10">
          <div className="loadbar h-full w-1/3 rounded-full bg-gradient-to-r from-violet-400 via-purple-400 to-fuchsia-400" />
        </div>

        <p className="text-[11px] text-slate-400/80">Loading your portfolio…</p>
      </div>
    </div>
  )
}
