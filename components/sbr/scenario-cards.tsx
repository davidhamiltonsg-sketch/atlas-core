"use client"

import { useState } from "react"
import { AnimatedNumber } from "@/components/animated-number"
import { formatCurrency } from "@/lib/utils"

export interface Scenario {
  name: string
  rate: number | null
  probability: number
  color: string
  description: string
}

interface ScenarioCardsProps {
  scenarios: Scenario[]
  defaultMonthly: number
  seedValue: number
  horizonMonths: number
  targetValue: number
}

function annuityFV(annualRate: number, months: number): number {
  const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1
  if (monthlyRate === 0) return months
  return (Math.pow(1 + monthlyRate, months) - 1) / monthlyRate
}

function projExit(seed: number, monthly: number, annualRate: number | null, months: number, floor: number): number {
  if (annualRate === null) return floor
  return seed * Math.pow(1 + annualRate, months / 12) + monthly * annuityFV(annualRate, months)
}

const PRESETS = [500, 1000, 1500, 2000, 3000]

export function ScenarioCards({ scenarios, defaultMonthly, seedValue, horizonMonths, targetValue }: ScenarioCardsProps) {
  const [monthly, setMonthly] = useState(defaultMonthly)
  const floor = seedValue + monthly * horizonMonths

  const exits = scenarios.map(s => ({
    ...s,
    exit: Math.round(projExit(seedValue, monthly, s.rate, horizonMonths, floor)),
  }))

  const expectedValue = Math.round(
    exits.reduce((sum, s) => sum + (s.probability / 100) * s.exit, 0),
  )

  return (
    <div className="space-y-5">
      {/* Contribution slider */}
      <div className="rounded-2xl border border-border bg-card/50 p-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Monthly contribution</p>
        <div className="flex items-center gap-4 mb-3">
          <span className="text-xs text-muted-foreground">SGD</span>
          <input
            type="number"
            min={0}
            step={100}
            value={monthly}
            onChange={e => setMonthly(Math.max(0, Math.round(Number(e.target.value) || 0)))}
            className="w-24 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-bold tabular-nums text-foreground focus:border-sky-500/50 focus:outline-none"
            aria-label="Monthly contribution in SGD"
          />
        </div>
        <input
          type="range"
          min={0}
          max={5000}
          step={50}
          value={Math.min(5000, monthly)}
          onChange={e => setMonthly(Number(e.target.value))}
          className="w-full accent-sky-500"
          aria-label="Monthly contribution slider"
        />
        <div className="flex gap-2 mt-2">
          {PRESETS.map(v => (
            <button
              key={v}
              onClick={() => setMonthly(v)}
              className={`rounded-full px-3 py-1 text-[10px] font-bold transition-colors ${
                monthly === v
                  ? "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                  : "bg-muted/40 text-muted-foreground border border-transparent hover:bg-muted/60"
              }`}
            >
              {formatCurrency(v, "SGD")}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-3">
          Total invested over {horizonMonths} months: <span className="font-semibold text-foreground">{formatCurrency(floor, "SGD")}</span> — your floor.
          Every exit below recomputes live from this amount.
        </p>
      </div>

      {/* Summary */}
      <div className="rounded-xl border border-border bg-card/30 px-5 py-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Probability-weighted expected value
        </p>
        <p className="text-lg font-black tabular-nums gradient-text">
          <AnimatedNumber value={expectedValue} currency="SGD" />
        </p>
      </div>

      {/* Scenario grid */}
      <div className="grid gap-3 sm:grid-cols-2">
        {exits.map(s => {
          const aboveTarget = s.exit >= targetValue
          const colorMap: Record<string, string> = {
            green: "border-green-500/30 bg-green-500/[0.04]",
            sky: "border-sky-500/30 bg-sky-500/[0.04]",
            amber: "border-amber-500/30 bg-amber-500/[0.04]",
            red: "border-red-500/30 bg-red-500/[0.04]",
          }
          const textMap: Record<string, string> = {
            green: "text-green-400",
            sky: "text-sky-400",
            amber: "text-amber-400",
            red: "text-red-400",
          }

          return (
            <div key={s.name} className={`rounded-xl border p-4 ${colorMap[s.color] ?? "border-border bg-card/50"}`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className={`text-sm font-bold ${textMap[s.color] ?? "text-foreground"}`}>{s.name}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {s.rate !== null ? `${(s.rate * 100).toFixed(0)}% p.a.` : "Capital floor"}
                  </p>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                  colorMap[s.color]?.replace("bg-", "bg-") ?? "border-border"
                } ${textMap[s.color] ?? "text-muted-foreground"}`}>
                  {s.probability}%
                </span>
              </div>
              <p className="text-xl font-black tabular-nums mt-1">
                <AnimatedNumber value={s.exit} currency="SGD" />
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">{s.description}</p>
              {aboveTarget && (
                <p className="text-[10px] text-green-400 mt-1 font-semibold">Clears the goal</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
