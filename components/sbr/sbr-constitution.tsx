import { Shell } from "@/components/shell"
import { FileText, Layers, ShieldCheck } from "lucide-react"
import { SILICON_BRICK_ROAD as SBR } from "@/lib/constitutions"
import { formatCurrency } from "@/lib/utils"

const HIDDEN_EXPOSURE = [
  { label: "Single company (any)", limit: "10%", action: "Redirect future contributions to diversified underweights." },
  { label: "Technology (IT + Comms, GICS)", limit: "45%", action: "Halt QQQM & SMH contributions until below the limit." },
  { label: "Semiconductors (combined)", limit: "20%", action: "Halt SMH contributions; trim if the SMH cap is separately breached." },
  { label: "United States (total)", limit: "75%", action: "Route new contributions to VWRA and A35 if approaching." },
  { label: "USD-denominated (total)", limit: "85%", action: "Increase SGD via A35 as the objective approaches; Phase IV corrects this." },
]

export function SbrConstitution({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  const rulesByCat = SBR.rules.reduce<Record<string, typeof SBR.rules>>((acc, r) => {
    (acc[r.category] ??= []).push(r); return acc
  }, {})

  return (
    <Shell title="The Constitution" subtitle={`Silicon Brick Road v${SBR.version} · ${SBR.motto}`} userName={name} isAdmin={isAdmin}>
      {/* Doc link */}
      <a href={SBR.docPath} target="_blank" rel="noopener noreferrer"
        className="rounded-xl border border-teal-500/40 bg-gradient-to-r from-teal-500/[0.08] to-emerald-500/[0.06] p-4 mb-5 flex items-center gap-3 hover:from-teal-500/[0.12] transition-colors group">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/20 shrink-0"><FileText className="h-4 w-4 text-teal-400" /></div>
        <div className="flex-1">
          <p className="text-xs font-bold text-teal-400">Full Constitution (v{SBR.version})</p>
          <p className="text-xs text-muted-foreground">Four Books — Constitution, Operations Manual, Property Acquisition, Registers & Dashboards — plus appendices and the oath.</p>
        </div>
        <span className="text-xs font-semibold text-teal-400 shrink-0">Open ↗</span>
      </a>

      {/* Objective */}
      <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.05] p-4 mb-6">
        <p className="text-xs font-bold text-violet-400 mb-0.5">North Star</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{SBR.objective} The purpose is not to maximise returns — it is to maximise the probability of success while eliminating avoidable behavioural mistakes. Target {formatCurrency(SBR.targetValue ?? 0, "SGD")}+ · {SBR.currency} base · {SBR.broker} · SGD {SBR.monthlyContribution.toLocaleString()}/mo.</p>
      </div>

      {/* Strategic allocation */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold">Strategic Allocation (Article VII)</h2><p className="mt-0.5 text-xs text-muted-foreground">Four funds. Drift rules redirect new money; outer limits trigger mandatory action.</p></div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead><tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/30">
              <th className="px-5 py-2.5">Fund</th><th className="px-3 py-2.5">Role</th><th className="px-3 py-2.5 text-right">Target</th><th className="px-3 py-2.5 text-right">Range</th><th className="px-3 py-2.5 text-right">Limit</th>
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
            <p className="text-[10px] font-bold uppercase tracking-wide text-amber-500 mb-1">{SBR.combined!.label}</p>
            <p className="text-lg font-black tabular-nums">Warn {SBR.combined!.warning}% · <span className="text-red-500">Hard {SBR.combined!.hard}%</span></p>
            <p className="text-[11px] text-muted-foreground mt-1">Halt both funds at 45%; resume once combined falls below {SBR.combined!.resume}%. The binding tech constraint.</p>
          </div>
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-blue-500 mb-1">Total equity maximum</p>
            <p className="text-lg font-black tabular-nums">{SBR.totalEquityMaxPct}%</p>
            <p className="text-[11px] text-muted-foreground mt-1">VWRA + QQQM + SMH ≤ 92% (target 90%). Above → redirect to A35 until below 90%.</p>
          </div>
        </div>
      </div>

      {/* Decision engine */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold">Decision Engine (Article VI)</h2><p className="mt-0.5 text-xs text-muted-foreground">Run each month. Stop at the first step that fires. There is always one clear answer.</p></div>
        <div className="divide-y divide-border">
          {SBR.decisionLadder.map((s) => (
            <div key={s.n} className="px-5 py-3 flex gap-3">
              <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-md bg-teal-500/10 text-teal-400 text-[11px] font-black">{s.n}</span>
              <div><p className="text-xs font-semibold">{s.title}</p><p className="text-[11px] text-muted-foreground mt-0.5">{s.detail}</p></div>
            </div>
          ))}
        </div>
      </div>

      {/* Phases */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2"><Layers className="h-4 w-4 text-teal-400" /><h2 className="text-sm font-semibold">Phase Framework (Article XII)</h2></div>
        <div className="divide-y divide-border">
          {(SBR.phases ?? []).map((p) => (
            <div key={p.key} className="px-5 py-3">
              <div className="flex items-center gap-2 mb-0.5"><span className="text-xs font-black text-teal-400">{p.label}</span><span className="text-[10px] text-muted-foreground">· {p.range}</span>{p.selling && <span className="rounded-full bg-amber-500/15 text-amber-500 px-2 py-0.5 text-[9px] font-bold uppercase ml-auto">sells</span>}</div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Hidden exposure */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold">Hidden Exposure Register (Article XVII)</h2><p className="mt-0.5 text-xs text-muted-foreground">Look-through limits — reviewed quarterly from Vanguard/Invesco/VanEck factsheets (IT + Communication Services = Technology, per GICS).</p></div>
        <div className="overflow-x-auto"><table className="w-full text-xs min-w-[560px]">
          <thead><tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/30"><th className="px-5 py-2.5">Exposure</th><th className="px-3 py-2.5 text-right">Limit</th><th className="px-5 py-2.5">If breached</th></tr></thead>
          <tbody className="divide-y divide-border">{HIDDEN_EXPOSURE.map((h) => (<tr key={h.label}><td className="px-5 py-3 font-medium">{h.label}</td><td className="px-3 py-3 text-right tabular-nums text-amber-500 font-semibold">{h.limit}</td><td className="px-5 py-3 text-muted-foreground">{h.action}</td></tr>))}</tbody>
        </table></div>
      </div>

      {/* Rules by category */}
      <div className="mb-2"><h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Constitution Rules</h2></div>
      <div className="space-y-4 mb-6">
        {Object.entries(rulesByCat).map(([cat, rules]) => (
          <div key={cat} className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-2.5 border-b border-border bg-muted/30"><p className="text-[10px] font-bold uppercase tracking-wider text-teal-400">{cat}</p></div>
            <div className="divide-y divide-border">
              {rules.map((r) => (<div key={r.title} className="px-5 py-3"><p className="text-xs font-semibold">{r.title}</p><p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{r.description}</p></div>))}
            </div>
          </div>
        ))}
      </div>

      {/* Scorecard */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-teal-400" /><h2 className="text-sm font-semibold">Governance Scorecard (Article XIX)</h2><span className="ml-auto text-[11px] text-muted-foreground">Target ≥ 95%</span></div>
        <div className="overflow-x-auto"><table className="w-full text-xs min-w-[560px]">
          <thead><tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/30"><th className="px-5 py-2.5">Category</th><th className="px-3 py-2.5 text-right">Weight</th><th className="px-5 py-2.5">Assessed</th></tr></thead>
          <tbody className="divide-y divide-border">{(SBR.scorecard ?? []).map((s) => (<tr key={s.category}><td className="px-5 py-3 font-medium">{s.category}</td><td className="px-3 py-3 text-right tabular-nums font-semibold">{s.weight}%</td><td className="px-5 py-3 text-muted-foreground">{s.assessed}</td></tr>))}</tbody>
        </table></div>
      </div>
    </Shell>
  )
}
