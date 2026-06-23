"use client"

import { useState } from "react"
import {
  TICKER_TARGETS, HARD_THRESHOLDS,
  BTC_CYCLE_MODIFIERS, getBtcCyclePhase, type BtcCyclePhase,
  SMH_SOFT_BANDS, getSmhSoftBand, getSmhCyclePhase,
  COMBINED_TECH_RULE,
} from "@/lib/constants"
import { Bitcoin, Cpu, Layers, Info } from "lucide-react"

const BTC_PHASES: BtcCyclePhase[] = ["post_halving_bull", "normal", "bear"]

export function FloatingCapsSection() {
  // BTC: default to the auto-detected phase, but let the user explore phases.
  const autoBtcPhase = getBtcCyclePhase()
  const [btcPhase, setBtcPhase] = useState<BtcCyclePhase>(autoBtcPhase)
  const btc = BTC_CYCLE_MODIFIERS[btcPhase]

  // SMH: slider is % below the 52-week high (-50%..0%). Stored as whole-number percent.
  const [smhPctInt, setSmhPctInt] = useState(-2) // SMH sits near its 52w high today
  const smhRatio = smhPctInt / 100
  const smhBand  = getSmhSoftBand(smhRatio)
  const smhPhase = getSmhCyclePhase(smhRatio)

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold">Floating Governance Caps (§4)</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Hard caps are static. Soft bands flex with the market cycle — BTC by halving phase (§4.1),
          SMH by distance from its 52-week high (§4.2). Combined tech concentration is a new v6.1 ceiling (§4.3).
        </p>
      </div>

      {/* BTC + SMH interactive cards */}
      <div className="grid gap-4 p-5 lg:grid-cols-2">

        {/* ── BTC halving cycle (§4.1) ── */}
        <div className="rounded-xl border border-border bg-background/40 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Bitcoin className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-bold">BTC — Halving Cycle Cap</h3>
            <span className="ml-auto text-[10px] font-semibold text-muted-foreground">§4.1</span>
          </div>

          <div className="flex gap-1.5 mb-3">
            {BTC_PHASES.map(p => {
              const on = p === btcPhase
              return (
                <button key={p} onClick={() => setBtcPhase(p)}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                    on ? "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                       : "border-border text-muted-foreground hover:bg-accent/60"
                  }`}>
                  {BTC_CYCLE_MODIFIERS[p].label}
                </button>
              )
            })}
          </div>

          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { label: "Target",    value: btc.target },
              { label: "Soft high", value: btc.softHigh },
              { label: "Hard cap",  value: btc.hardHigh },
            ].map(s => (
              <div key={s.label} className="rounded-lg bg-muted/40 px-2 py-2 text-center">
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
                <p className="text-base font-black tabular-nums">{s.value}%</p>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">{btc.rationale}</p>
          {btcPhase === autoBtcPhase ? (
            <p className="mt-2 text-[10px] font-semibold text-green-600 dark:text-green-400">● Current phase (auto-detected)</p>
          ) : (
            <p className="mt-2 text-[10px] text-muted-foreground">Previewing — current auto-detected phase is “{BTC_CYCLE_MODIFIERS[autoBtcPhase].label}”.</p>
          )}
        </div>

        {/* ── SMH cycle-aware soft band (§4.2) ── */}
        <div className="rounded-xl border border-border bg-background/40 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Cpu className="h-4 w-4 text-violet-500" />
            <h3 className="text-sm font-bold">SMH — Cycle-Aware Soft Band</h3>
            <span className="ml-auto text-[10px] font-semibold text-muted-foreground">§4.2</span>
          </div>

          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground">Distance from 52-week high</span>
              <span className="text-[11px] font-bold tabular-nums">{smhPctInt}%</span>
            </div>
            <input
              type="range" min={-50} max={0} step={1} value={smhPctInt}
              onChange={e => setSmhPctInt(parseInt(e.target.value, 10))}
              className="w-full accent-violet-500"
            />
            <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
              <span>−50% (bottom)</span><span>−20%</span><span>at high</span>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              smhPhase === "top"    ? "bg-red-500/10 text-red-500" :
              smhPhase === "bottom" ? "bg-green-500/10 text-green-500" :
                                      "bg-amber-500/10 text-amber-500"
            }`}>{smhBand.label}</span>
            <span className="text-[11px] text-muted-foreground">Soft band {smhBand.softLow}%–{smhBand.softHigh}% · hard cap {HARD_THRESHOLDS.SMH.high}%</span>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">{smhBand.signal}</p>
        </div>
      </div>

      {/* ── Combined tech concentration (§4.3, NEW) ── */}
      <div className="mx-5 mb-5 rounded-xl border border-indigo-500/25 bg-indigo-500/[0.05] p-4">
        <div className="flex items-center gap-2 mb-2">
          <Layers className="h-4 w-4 text-indigo-500" />
          <h3 className="text-sm font-bold">{COMBINED_TECH_RULE.label}</h3>
          <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[9px] font-bold text-indigo-500">NEW · §4.3</span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">{COMBINED_TECH_RULE.rationale}</p>
        <div className="flex flex-wrap gap-4">
          <div>
            <p className="text-[10px] text-muted-foreground">{COMBINED_TECH_RULE.tickers.join(" + ")} soft ceiling</p>
            <p className="text-lg font-black tabular-nums text-amber-500">{COMBINED_TECH_RULE.softCeiling}%</p>
            <p className="text-[10px] text-muted-foreground">{COMBINED_TECH_RULE.action.soft}</p>
          </div>
          <div className="h-12 w-px bg-border" />
          <div>
            <p className="text-[10px] text-muted-foreground">Hard ceiling</p>
            <p className="text-lg font-black tabular-nums text-red-500">{COMBINED_TECH_RULE.hardCeiling}%</p>
            <p className="text-[10px] text-muted-foreground">{COMBINED_TECH_RULE.action.hard}</p>
          </div>
        </div>
      </div>

      {/* ── Effective caps table: static vs cycle-aware ── */}
      <div className="px-5 pb-5">
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Asset", "Target", "Static hard cap", "Cycle-aware band"].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(["VT", "QQQM", "SMH", "VWO", "BTC"] as const).map(tk => {
                const target = TICKER_TARGETS[tk]
                const hard   = HARD_THRESHOLDS[tk]
                const floats = tk === "BTC" || tk === "SMH"
                let cycleCell = "—"
                if (tk === "BTC") cycleCell = `${btc.label}: soft ${btc.softHigh}% · hard ${btc.hardHigh}%`
                if (tk === "SMH") cycleCell = `${smhBand.label}: soft ${smhBand.softLow}%–${smhBand.softHigh}%`
                return (
                  <tr key={tk} className="hover:bg-accent/20 transition-colors">
                    <td className="px-4 py-3 font-bold">{tk}</td>
                    <td className="px-4 py-3 tabular-nums">{target}%</td>
                    <td className="px-4 py-3 tabular-nums text-red-400">
                      {hard.low !== undefined ? `${hard.low}%–${hard.high}%` : `≤ ${hard.high}%`}
                    </td>
                    <td className={`px-4 py-3 ${floats ? "text-indigo-600 dark:text-indigo-300 font-medium" : "text-muted-foreground"}`}>
                      {floats ? cycleCell : "Static — no cycle modifier"}
                    </td>
                  </tr>
                )
              })}
              <tr className="bg-indigo-500/[0.04]">
                <td className="px-4 py-3 font-bold">QQQM+SMH</td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">—</td>
                <td className="px-4 py-3 tabular-nums text-red-400">≤ {COMBINED_TECH_RULE.hardCeiling}%</td>
                <td className="px-4 py-3 text-indigo-600 dark:text-indigo-300 font-medium">Combined tech: soft {COMBINED_TECH_RULE.softCeiling}% · hard {COMBINED_TECH_RULE.hardCeiling}%</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1.5">
          <Info className="h-3 w-3" /> Static hard caps (VT 62%, QQQM 31%, SMH 12%, VWO 13%) are unchanged. Only BTC&apos;s hard cap floats by cycle phase; SMH&apos;s soft band flexes while its 12% hard cap holds.
        </p>
      </div>
    </div>
  )
}
