import { BrandMark } from "@/components/brand/brand-mark"
import { getPortfolioHint } from "@/lib/session"

export default async function Loading() {
  const hint = await getPortfolioHint()
  const id = hint === "silicon-brick-road" ? "silicon-brick-road" : "atlas-core"
  const name = id === "silicon-brick-road" ? "Silicon Brick Road" : "Atlas Core"
  return (
    <div data-theme={id === "silicon-brick-road" ? "sbr" : "atlas-core"} className="fixed inset-0 z-50 grid place-items-center bg-background">
      <div className="w-[min(88vw,420px)] rounded-2xl border border-border bg-card/90 p-7 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <BrandMark constitutionId={id} className="h-11 w-11" />
          <div><p className="font-display text-lg font-semibold">{name}</p><p className="font-data text-[10px] uppercase tracking-[.22em] text-muted-foreground">Synchronising portfolio</p></div>
        </div>
        <div className="mt-7 grid gap-2" aria-label="Loading">
          <div className="h-2 w-full rounded-full bg-muted" />
          <div className="h-2 w-4/5 rounded-full bg-muted" />
          <div className="h-2 w-3/5 rounded-full bg-muted" />
        </div>
        <p className="mt-5 text-xs text-muted-foreground">Reading holdings, rules and source freshness…</p>
      </div>
    </div>
  )
}
