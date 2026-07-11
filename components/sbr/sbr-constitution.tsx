import { Shell } from "@/components/shell"
import { FileText, Layers, ShieldCheck } from "lucide-react"
import { SILICON_BRICK_ROAD as SBR } from "@/lib/constitutions"
import { formatCurrency } from "@/lib/utils"
import { ThresholdGauge, type ThresholdGaugeRow } from "@/components/governance/threshold-gauge"

const HIDDEN_EXPOSURE = [
  { label: "Single company", limit: "10%", action: "Put new contributions into other funds until it drops below 10%." },
  { label: "Technology stocks (combined)", limit: "45%", action: "Stop buying EQQQ and SEMI until it comes back below 45%." },
  { label: "Semiconductor stocks (combined)", limit: "20%", action: "Stop buying SEMI. If SEMI itself is also over 20%, sell some too." },
  { label: "US market (total exposure)", limit: "75%", action: "Route new contributions to VWRA and A35 instead." },
  { label: "US dollar assets (total)", limit: "85%", action: "Build up A35 (SGD bonds) as you get closer to the property goal." },
]

export function SbrConstitution({ name, isAdmin, allocMap = {} }: { name: string; isAdmin: boolean; allocMap?: Record<string, number> }) {
  const rulesByCat = SBR.rules.reduce<Record<string, typeof SBR.rules>>((acc, r) => {
    (acc[r.category] ??= []).push(r); return acc
  }, {})

  // Live gauge rows derived from the same fund rule numbers as the "Strategic allocation"
  // table above — a fund with no hardCap (A35) is floor-based, so its hard "high" bound is
  // presentational only (a wide ceiling for the bar's scale, not an enforced limit).
  const gaugeRows: ThresholdGaugeRow[] = SBR.funds.map((f) => {
    const hardLow = f.floor ?? 0
    const hardHigh = f.hardCap ?? Math.max(f.rangeHigh + 10, 30)
    return {
      ticker: f.ticker, color: f.color, classification: f.role, target: f.target,
      hardLow, hardHigh, softLow: hardLow, softHigh: hardHigh,
      healthyLow: f.rangeLow, healthyHigh: f.rangeHigh,
    }
  })

  return (
    <Shell title="The Plan" subtitle={`Silicon Brick Road v${SBR.version} · ${SBR.motto}`} userName={name} isAdmin={isAdmin}>
      {/* Doc link */}
      <a href={SBR.docPath} target="_blank" rel="noopener noreferrer"
        className="rounded-xl border border-sky-500/40 bg-gradient-to-r from-sky-500/[0.10] via-blue-500/[0.07] to-cyan-500/[0.06] p-4 mb-5 flex items-center gap-3 hover:from-sky-500/[0.12] transition-colors group">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/20 shrink-0"><FileText className="h-4 w-4 text-sky-400" /></div>
        <div className="flex-1">
          <p className="text-xs font-bold text-sky-400">Full Document (v{SBR.version})</p>
          <p className="text-xs text-muted-foreground">The complete written plan — rules, monthly steps, property purchase guide, and record-keeping templates.</p>
        </div>
        <span className="text-xs font-semibold text-sky-400 shrink-0">Open ↗</span>
      </a>

      {/* Objective */}
      <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.05] p-4 mb-6">
        <p className="text-xs font-bold text-violet-400 mb-0.5">The Goal</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{SBR.objective} This is not about beating the market — it is about getting to {formatCurrency(SBR.targetValue ?? 0, "SGD")} without making avoidable mistakes along the way. Monthly contribution: SGD {SBR.monthlyContribution.toLocaleString()} · Account: {SBR.broker}.</p>
      </div>

      {/* Strategic allocation */}
      <div className="rounded-xl card-lux overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold">How to Split Your Money</h2><p className="mt-0.5 text-xs text-muted-foreground">Four funds. When something drifts, new money fixes it. If something hits its hard limit, you must act.</p></div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead><tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/30">
              <th className="px-5 py-2.5">Fund</th><th className="px-3 py-2.5">What it does</th><th className="px-3 py-2.5 text-right">Target</th><th className="px-3 py-2.5 text-right">Healthy range</th><th className="px-3 py-2.5 text-right">Hard limit</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {SBR.funds.map((f) => (
                <tr key={f.ticker}>
                  <td className="px-5 py-3"><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: f.color }} /><span className="font-bold">{f.ticker}</span></div><span className="text-[11px] text-muted-foreground">{f.name}</span></td>
                  <td className="px-3 py-3 text-muted-foreground">{f.role}</td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold">{f.target}%</td>
                  <td className="px-3 py-3 text-right tabular-nums">{f.rangeLow}–{f.rangeHigh}%</td>
                  <td className="px-3 py-3 text-right tabular-nums text-red-400">{f.hardCap ? `${f.hardCap}%` : `${f.floor}% floor`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 p-5">
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-amber-500 mb-1">Tech stocks cap (EQQQ + SEMI combined)</p>
            <p className="text-lg font-black tabular-nums">Warn {SBR.combined!.warning}% · <span className="text-red-500">Stop {SBR.combined!.hard}%</span></p>
            <p className="text-[11px] text-muted-foreground mt-1">At 40%, stop buying both. At 45%, halt both completely until they drop below {SBR.combined!.resume}%. EQQQ and SEMI overlap heavily — this cap stops them from taking over.</p>
          </div>
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-blue-500 mb-1">Stocks maximum (all three equity funds)</p>
            <p className="text-lg font-black tabular-nums">{SBR.totalEquityMaxPct}%</p>
            <p className="text-[11px] text-muted-foreground mt-1">VWRA + EQQQ + SEMI combined should stay below 90%. If they push above {SBR.totalEquityMaxPct}%, put new money into A35 until they come back down.</p>
          </div>
        </div>
      </div>

      {/* Live fund gauges */}
      <div className="rounded-xl card-lux overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Where Each Fund Stands Right Now</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Your current percentage vs the comfortable range (green), the warning zone (amber), and the hard limit (red)
          </p>
        </div>
        <ThresholdGauge rows={gaugeRows} allocMap={allocMap} />
      </div>

      {/* Decision engine */}
      <div className="rounded-xl card-lux overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold">What to Do Each Month</h2><p className="mt-0.5 text-xs text-muted-foreground">Go through this checklist in order. Stop at the first step that applies. There is always one clear answer.</p></div>
        <div className="divide-y divide-border">
          {SBR.decisionLadder.map((s) => (
            <div key={s.n} className="px-5 py-3 flex gap-3">
              <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-md bg-sky-500/10 text-sky-400 text-[11px] font-black">{s.n}</span>
              <div><p className="text-xs font-semibold">{s.title}</p><p className="text-[11px] text-muted-foreground mt-0.5">{s.detail}</p></div>
            </div>
          ))}
        </div>
      </div>

      {/* Phases */}
      <div className="rounded-xl card-lux overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2"><Layers className="h-4 w-4 text-sky-400" /><h2 className="text-sm font-semibold">The Four Phases of Your Journey</h2></div>
        <div className="divide-y divide-border">
          {(SBR.phases ?? []).map((p) => (
            <div key={p.key} className="px-5 py-3">
              <div className="flex items-center gap-2 mb-0.5"><span className="text-xs font-black text-sky-400">{p.label}</span><span className="text-[10px] text-muted-foreground">· {p.range}</span>{p.selling && <span className="rounded-full bg-amber-500/15 text-amber-500 px-2 py-0.5 text-[9px] font-bold uppercase ml-auto">sells</span>}</div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Hidden exposure */}
      <div className="rounded-xl card-lux overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold">What You Actually Own (Inside the Funds)</h2><p className="mt-0.5 text-xs text-muted-foreground">VWRA, EQQQ and SEMI all hold many of the same companies. These limits stop you accidentally over-concentrating without realising it. Check quarterly using each fund&apos;s factsheet.</p></div>
        <div className="overflow-x-auto"><table className="w-full text-xs min-w-[560px]">
          <thead><tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/30"><th className="px-5 py-2.5">Exposure type</th><th className="px-3 py-2.5 text-right">Limit</th><th className="px-5 py-2.5">What to do if over the limit</th></tr></thead>
          <tbody className="divide-y divide-border">{HIDDEN_EXPOSURE.map((h) => (<tr key={h.label}><td className="px-5 py-3 font-medium">{h.label}</td><td className="px-3 py-3 text-right tabular-nums text-amber-500 font-semibold">{h.limit}</td><td className="px-5 py-3 text-muted-foreground">{h.action}</td></tr>))}</tbody>
        </table></div>
      </div>

      {/* Rules by category */}
      <div className="mb-2"><h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">The Rules</h2></div>
      <div className="space-y-4 mb-6">
        {Object.entries(rulesByCat).map(([cat, rules]) => (
          <div key={cat} className="rounded-xl card-lux overflow-hidden">
            <div className="px-5 py-2.5 border-b border-border bg-muted/30"><p className="text-[10px] font-bold uppercase tracking-wider text-sky-400">{cat}</p></div>
            <div className="divide-y divide-border">
              {rules.map((r) => (<div key={r.title} className="px-5 py-3"><p className="text-xs font-semibold">{r.title}</p><p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{r.description}</p></div>))}
            </div>
          </div>
        ))}
      </div>

      {/* Scorecard */}
      <div className="rounded-xl card-lux overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-sky-400" /><h2 className="text-sm font-semibold">Monthly Health Check</h2><span className="ml-auto text-[11px] text-muted-foreground">Target score ≥ 95%</span></div>
        <div className="overflow-x-auto"><table className="w-full text-xs min-w-[560px]">
          <thead><tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/30"><th className="px-5 py-2.5">What we check</th><th className="px-3 py-2.5 text-right">Weight</th><th className="px-5 py-2.5">Pass condition</th></tr></thead>
          <tbody className="divide-y divide-border">{(SBR.scorecard ?? []).map((s) => (<tr key={s.category}><td className="px-5 py-3 font-medium">{s.category}</td><td className="px-3 py-3 text-right tabular-nums font-semibold">{s.weight}%</td><td className="px-5 py-3 text-muted-foreground">{s.assessed}</td></tr>))}</tbody>
        </table></div>
      </div>
    </Shell>
  )
}
