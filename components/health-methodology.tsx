"use client"

import { useState } from "react"
import { ChevronDown, Info } from "lucide-react"

interface HealthMethodologyProps {
  structural: number
  behavioural: number
  concentration: number
  execution: number
  hardBreaches: number
  softBreaches: number
  maxDrift: number
  activeRules: number
  totalRules: number
  snapshotAgeDays: number
}

const DIM_WEIGHTS = [
  { label: "Structural",     weight: 40, desc: "Allocation integrity — drift vs targets" },
  { label: "Behavioural",    weight: 25, desc: "Governance rule compliance rate" },
  { label: "Concentration",  weight: 25, desc: "Hard-cap breach exposure" },
  { label: "Execution",      weight: 10, desc: "Snapshot data freshness" },
]

export function HealthMethodology({
  structural, behavioural, concentration, execution,
  hardBreaches, softBreaches, maxDrift,
  activeRules, totalRules, snapshotAgeDays,
}: HealthMethodologyProps) {
  const [open, setOpen] = useState(false)

  const dims = [
    { label: "Structural",    score: structural,    weight: 40 },
    { label: "Behavioural",   score: behavioural,   weight: 25 },
    { label: "Concentration", score: concentration, weight: 25 },
    { label: "Execution",     score: execution,     weight: 10 },
  ]

  const overall = Math.round(dims.reduce((s, d) => s + d.score * (d.weight / 100), 0))

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        <Info className="h-3 w-3" />
        <span>How this score is calculated</span>
        <ChevronDown className={`h-3 w-3 ml-auto transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-3 space-y-4 text-[11px]">
          {/* Formula */}
          <div className="rounded-lg bg-muted/60 px-3 py-2.5 font-mono text-[10px] text-muted-foreground leading-relaxed">
            <p className="text-foreground font-semibold mb-1.5">Overall = weighted composite</p>
            {dims.map((d) => (
              <p key={d.label}>
                <span className="text-foreground">{d.label}</span>
                {" "}× {d.weight}% = <span className="tabular-nums">{Math.round(d.score * d.weight / 100)}</span>
              </p>
            ))}
            <p className="border-t border-border/60 mt-1.5 pt-1.5 text-foreground">
              Total = {overall} / 100
            </p>
          </div>

          {/* Dimensions */}
          <div className="space-y-3">
            {/* Structural */}
            <div>
              <p className="font-semibold text-foreground mb-1">Structural · 40%</p>
              <p className="text-muted-foreground leading-relaxed mb-1.5">
                100 − (hard breaches × 20) − (soft breaches × 8) − (max drift × 1.2)
              </p>
              <div className="rounded bg-muted/40 px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground space-y-0.5">
                <p>Hard breaches: <span className="text-foreground">{hardBreaches}</span> × 20 = <span className="text-foreground">{hardBreaches * 20}</span></p>
                <p>Soft breaches: <span className="text-foreground">{softBreaches}</span> × 8 = <span className="text-foreground">{softBreaches * 8}</span></p>
                <p>Max drift: <span className="text-foreground">{maxDrift.toFixed(1)}%</span> × 1.2 = <span className="text-foreground">{(maxDrift * 1.2).toFixed(1)}</span></p>
                <p className="border-t border-border/60 pt-0.5 text-foreground">Score: {structural}</p>
              </div>
            </div>

            {/* Behavioural */}
            <div>
              <p className="font-semibold text-foreground mb-1">Behavioural · 25%</p>
              <p className="text-muted-foreground leading-relaxed mb-1.5">
                (Active rules ÷ Total rules) × 100
              </p>
              <div className="rounded bg-muted/40 px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground space-y-0.5">
                <p>{activeRules} active / {totalRules} total = <span className="text-foreground">{behavioural}</span></p>
              </div>
            </div>

            {/* Concentration */}
            <div>
              <p className="font-semibold text-foreground mb-1">Concentration · 25%</p>
              <p className="text-muted-foreground leading-relaxed mb-1.5">
                Only hard-cap breaches penalised. Governed concentration within caps is not pathological.
              </p>
              <div className="rounded bg-muted/40 px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground">
                <p>Score: <span className="text-foreground">{concentration}</span></p>
              </div>
            </div>

            {/* Execution */}
            <div>
              <p className="font-semibold text-foreground mb-1">Execution · 10%</p>
              <p className="text-muted-foreground leading-relaxed mb-1.5">
                Snapshot freshness tier: ≤3d = 100 · ≤7d = 95 · ≤14d = 85 · ≤30d = 70 · ≤60d = 45 · older = 20
              </p>
              <div className="rounded bg-muted/40 px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground">
                <p>Last snapshot: <span className="text-foreground">{snapshotAgeDays < 1 ? "today" : `${snapshotAgeDays}d ago`}</span> → score <span className="text-foreground">{execution}</span></p>
              </div>
            </div>
          </div>

          {/* Thresholds */}
          <div className="rounded-lg border border-border px-3 py-2.5 space-y-1 text-[10px]">
            <p className="font-semibold text-foreground mb-1">Score interpretation</p>
            <div className="flex gap-2 items-center"><span className="h-1.5 w-1.5 rounded-full bg-green-500" /><span className="text-muted-foreground">≥ 80 — Good standing</span></div>
            <div className="flex gap-2 items-center"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /><span className="text-muted-foreground">65–79 — Review recommended</span></div>
            <div className="flex gap-2 items-center"><span className="h-1.5 w-1.5 rounded-full bg-red-500" /><span className="text-muted-foreground">&lt; 65 — Action required</span></div>
          </div>
        </div>
      )}
    </div>
  )
}
