import { AtlasCoreMark, SbrMark, AtlasUniverseMark } from "@/components/brand/brand-mark"
import { getPortfolioHint } from "@/lib/session"

// Branded loading splash — shown while a page's live data (prices, holdings) loads,
// so the user sees a crest before the dashboard paints. Calm, but clearly moving.
// Reads the (non-auth) portfolio_hint cookie server-side, synchronously, so there's
// no client-side flash: signed-in users see their own crest; everyone else — not yet
// signed in, or the hint cookie was cleared on logout — sees BOTH crests, since we
// don't yet know which portfolio they're headed for.

function SplashShell({
  background,
  glow,
  children,
}: {
  background: string
  glow: string
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden" style={{ background }}>
      <div className="pointer-events-none absolute -top-1/4 left-1/2 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full opacity-30 blur-3xl" style={{ background: glow }} />
      <div className="relative flex flex-col items-center gap-7">{children}</div>
    </div>
  )
}

function SpinningMark({ Mark, conic, glowShadow }: { Mark: typeof AtlasCoreMark; conic: string; glowShadow: string }) {
  return (
    <div className="relative float-soft">
      <div
        className="absolute -inset-4 rounded-full animate-spin"
        style={{
          animationDuration: "2.8s",
          background: conic,
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
        }}
      />
      <div className="relative" style={{ filter: `drop-shadow(${glowShadow})` }}>
        <Mark className="h-20 w-20" />
      </div>
    </div>
  )
}

export default async function Loading() {
  const hint = await getPortfolioHint()

  if (hint === "silicon-brick-road") {
    return (
      <SplashShell
        background="radial-gradient(120% 120% at 50% 0%, hsl(217 44% 9%) 0%, hsl(217 44% 5%) 60%)"
        glow="radial-gradient(circle, rgba(14,165,233,0.5), transparent 60%)"
      >
        <SpinningMark
          Mark={SbrMark}
          conic="conic-gradient(from 0deg, transparent 0%, #38bdf8 20%, #3b82f6 45%, #22d3ee 60%, transparent 80%)"
          glowShadow="0 12px 30px rgba(14,165,233,0.45)"
        />
        <div className="text-center">
          <p className="font-display text-lg font-semibold tracking-tight text-white">Silicon Brick Road</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-[0.25em] text-sky-300/70">Saving Toward Your Deposit</p>
        </div>
        <div className="h-1 w-44 overflow-hidden rounded-full bg-white/10">
          <div className="loadbar h-full w-1/3 rounded-full bg-gradient-to-r from-sky-400 via-blue-400 to-cyan-400" />
        </div>
        <p className="text-[11px] text-slate-400/80">Loading your plan…</p>
      </SplashShell>
    )
  }

  if (hint === "atlas-core") {
    return (
      <SplashShell
        background="radial-gradient(120% 120% at 50% 0%, hsl(259 34% 9%) 0%, hsl(259 34% 5%) 60%)"
        glow="radial-gradient(circle, rgba(124,58,237,0.5), transparent 60%)"
      >
        <SpinningMark
          Mark={AtlasCoreMark}
          conic="conic-gradient(from 0deg, transparent 0%, #a78bfa 20%, #c084fc 45%, #e879f9 60%, transparent 80%)"
          glowShadow="0 12px 30px rgba(124,58,237,0.45)"
        />
        <div className="text-center">
          <p className="font-display text-lg font-semibold tracking-tight text-white">Atlas Core</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-[0.25em] text-violet-300/70">Investment Operating System</p>
        </div>
        <div className="h-1 w-44 overflow-hidden rounded-full bg-white/10">
          <div className="loadbar h-full w-1/3 rounded-full bg-gradient-to-r from-violet-400 via-purple-400 to-fuchsia-400" />
        </div>
        <p className="text-[11px] text-slate-400/80">Loading your portfolio…</p>
      </SplashShell>
    )
  }

  // No hint yet (not signed in, or just logged out) — its own brandmark: two
  // interlocking rings, violet and sky, meeting at a gold star. "Two
  // constitutions, one discipline" made visual, not two logos side by side.
  return (
    <SplashShell
      background="radial-gradient(120% 120% at 50% 0%, hsl(250 24% 8%) 0%, hsl(250 24% 5%) 60%)"
      glow="radial-gradient(60% 60% at 20% 20%, rgba(124,58,237,0.35), transparent 65%), radial-gradient(60% 60% at 80% 20%, rgba(14,165,233,0.35), transparent 65%)"
    >
      <SpinningMark
        Mark={AtlasUniverseMark}
        conic="conic-gradient(from 0deg, transparent 0%, #a78bfa 20%, #dfaf4b 45%, #38bdf8 60%, transparent 80%)"
        glowShadow="0 14px 34px rgba(223,175,75,0.35)"
      />
      <div className="text-center">
        <p className="font-display text-2xl font-semibold tracking-tight gradient-text-universe pb-1">Atlas Universe</p>
        <p className="mt-0.5 text-[11px] uppercase tracking-[0.25em] text-slate-300/70">Two Constitutions, One Discipline</p>
      </div>
      <div className="h-1 w-44 overflow-hidden rounded-full bg-white/10">
        <div className="loadbar h-full w-1/3 rounded-full bg-gradient-to-r from-violet-400 via-amber-300 to-sky-400" />
      </div>
      <p className="text-[11px] text-slate-400/80">Loading…</p>
    </SplashShell>
  )
}
