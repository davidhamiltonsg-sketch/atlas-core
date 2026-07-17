'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { SBR_SPEC } from '@/lib/portfolio-spec'
import { runMC, drawFanCanvas, formatFanValue, heatCell, type AssetConfig, type MCResult } from '@/lib/gbm-engine'

// Asset weights and expected returns are sourced from SBR_SPEC.funds instead of being
// duplicated here — see the matching comment in probability-engine.tsx (Atlas) for why.
const SBR_ASSETS: AssetConfig[] = SBR_SPEC.funds
  .filter((f): f is typeof f & { expectedReturn: NonNullable<typeof f.expectedReturn> } => f.expectedReturn !== undefined)
  .map(f => ({
    ticker: f.ticker,
    weight: f.target / 100,
    mu: [f.expectedReturn.conservative, f.expectedReturn.base, f.expectedReturn.aggressive],
  }))

const CYAN = '#06b6d4'

// ── Component ─────────────────────────────────────────────────────────────────
const MS = [500_000, 1_000_000, 1_500_000]
const MSL = ['S$500K', 'S$1M', 'S$1.5M']
const MSY = [5, 10, 15]
const DD_LBLS = ['Minor (>20%)', 'Correction (>30%)', 'Severe (>40%)', 'Crisis (>50%)']
const DD_CLRS = ['text-yellow-400', 'text-orange-400', 'text-red-400', 'text-red-600']
const DD_GOV = [
  'Watch: Monitor monthly, continue contributions',
  'Pause: Review next move, may reduce contributions',
  'Review: Governance reassessment required',
  'Resume: Formal pause lifted when recovered',
]

function heatCellSbr(p: number) {
  return heatCell(p, '6,182,212')
}

export function SbrProbabilityEngine({
  startValue,
  monthlyDca,
  annualBonus,
  contributionGrowthRate,
}: {
  startValue: number
  monthlyDca: number
  annualBonus: number
  contributionGrowthRate: number
}) {
  const [dca, setDca] = useState(monthlyDca)
  const [bonus, setBonus] = useState(annualBonus)
  const [sv, setSv] = useState(Math.max(0, Math.round(startValue)))
  const [scenario, setScenario] = useState(1)
  const [nPaths, setNPaths] = useState(2000)
  const [horizon, setHorizon] = useState(15)
  const [result, setResult] = useState<MCResult | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [hasRun, setHasRun] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runSim = useCallback((
    _dca: number, _bonus: number, _sv: number, _si: number, _np: number, _horizon: number
  ) => {
    setIsRunning(true)
    setTimeout(() => {
      try {
        const r = runMC(SBR_ASSETS, _np, _si, _sv, _horizon, _dca, _bonus, contributionGrowthRate, MS, MSY)
        setResult(r)
        setHasRun(true)
      } finally {
        setIsRunning(false)
      }
    }, 20)
  }, [contributionGrowthRate])

  const scheduleRun = useCallback((
    _dca: number, _bonus: number, _sv: number, _si: number, _np: number, _horizon: number
  ) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSim(_dca, _bonus, _sv, _si, _np, _horizon), 350)
  }, [runSim])

  useEffect(() => {
    scheduleRun(dca, bonus, sv, scenario, nPaths, horizon)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [dca, bonus, sv, scenario, nPaths, horizon, scheduleRun])

  const chartOpts = useMemo(() => ({
    accentColor: CYAN,
    currencySymbol: 'S$',
    milestones: [
      { value: 500_000, label: 'S$500K', color: '#22d3ee' },
      { value: 1_000_000, label: 'S$1M', color: '#a78bfa' },
      { value: 1_500_000, label: 'S$1.5M', color: '#c084fc' },
    ],
    xGridStepYears: 5,
    // Flexible horizon — no fixed target year, so mark whichever waypoints fall within range
    // instead of a single terminal year the way Atlas does with 2045.
    markerYears: [5, 10, 15].filter(y => y <= horizon),
  }), [horizon])

  useEffect(() => {
    if (result && canvasRef.current) {
      drawFanCanvas(canvasRef.current, result.fan, horizon, chartOpts)
    }
  }, [result, horizon, chartOpts])

  useEffect(() => {
    const obs = new ResizeObserver(() => {
      if (result && canvasRef.current) drawFanCanvas(canvasRef.current, result.fan, horizon, chartOpts)
    })
    if (canvasRef.current) obs.observe(canvasRef.current)
    return () => obs.disconnect()
  }, [result, horizon, chartOpts])

  const SCENARIOS = [
    { label: 'Conservative', color: 'text-amber-400' },
    { label: 'Base Case', color: 'text-cyan-400' },
    { label: 'Aggressive', color: 'text-green-400' },
  ]

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">GBM Probability Engine</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Monte Carlo simulation · {nPaths.toLocaleString()} paths · {horizon}-year horizon · SBR watch/pause/resume
          </p>
        </div>
        {isRunning && (
          <span className="text-[11px] text-cyan-400 animate-pulse font-medium">Running…</span>
        )}
      </div>

      {/* Controls */}
      <div className="px-5 py-4 border-b border-border grid gap-4 sm:grid-cols-2 lg:grid-cols-5 bg-muted/20">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">
            Starting value (SGD)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range" min={0} max={500000} step={5000} value={sv}
              onChange={e => setSv(+e.target.value)}
              className="flex-1 h-1 accent-cyan-400"
            />
            <span className="text-sm font-bold tabular-nums w-20 text-right">
              S${(sv / 1000).toFixed(0)}K
            </span>
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">
            Horizon
          </label>
          <div className="flex gap-1 flex-wrap">
            {[5, 10, 15].map(y => (
              <button
                key={y}
                onClick={() => setHorizon(y)}
                className={`text-[10px] font-bold px-2 py-1 rounded border transition-colors ${
                  horizon === y
                    ? 'bg-cyan-400/20 text-cyan-400 border-cyan-400/50'
                    : 'bg-transparent border-border text-muted-foreground hover:border-cyan-400/30'
                }`}
              >
                {y}y
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">
            Monthly (SGD)
          </label>
          <div className="flex gap-1 flex-wrap">
            {[1000, 2000, 3000].map(v => (
              <button
                key={v}
                onClick={() => setDca(v)}
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border text-xs transition-colors ${
                  dca === v
                    ? 'bg-cyan-400/20 text-cyan-400 border-cyan-400/50'
                    : 'bg-transparent border-border text-muted-foreground hover:border-cyan-400/30'
                }`}
              >
                {(v / 1000).toFixed(0)}K
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">
            Annual Bonus
          </label>
          <select
            value={scenario}
            onChange={e => setScenario(+e.target.value)}
            className="w-full rounded border border-border bg-background text-sm px-2 py-1"
          >
            {SCENARIOS.map((s, i) => (
              <option key={i} value={i}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block">
            Simulation Paths
          </label>
          <select
            value={nPaths}
            onChange={e => setNPaths(+e.target.value)}
            className="w-full rounded border border-border bg-background text-sm px-2 py-1"
          >
            <option value={1000}>1,000 paths</option>
            <option value={2000}>2,000 paths</option>
            <option value={5000}>5,000 paths</option>
          </select>
        </div>
      </div>

      {/* Fan chart */}
      <div className="px-5 py-4 border-b border-border">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Growth Scenarios · {horizon}-Year Percentile Fan
        </p>
        {!hasRun ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
            {isRunning ? 'Running simulation…' : 'Awaiting first run…'}
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="w-full"
            style={{ height: 280 }}
          />
        )}
        {result && (
          <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-1.5 rounded" style={{ background: '#06b6d4', opacity: 0.15 }} />
              P10–P90 range
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-1.5 rounded" style={{ background: '#06b6d4', opacity: 0.35 }} />
              P25–P75 range
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-2" style={{ background: '#06b6d4', borderRadius: 2 }} />
              P50 median
            </span>
          </div>
        )}
      </div>

      {/* Stats strip */}
      {result && (
        <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-border border-b border-border">
          {(['P10', 'P25', 'P50 Median', 'P75', 'P90', 'P50 4% Rule'] as const).map((lbl, i) => {
            const v = result.fan[horizon]
            const vals = [v[1], v[2], v[3], v[4], v[5], v[3] * 0.04 / 12]
            const colors = ['text-muted-foreground', 'text-amber-400', 'text-cyan-400', 'text-green-400', 'text-green-400', 'text-cyan-400']
            return (
              <div key={lbl} className="px-3 py-2.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{lbl}</p>
                <p className={`text-sm font-black tabular-nums mt-0.5 ${colors[i]}`}>{formatFanValue(vals[i], 'S$')}</p>
              </div>
            )
          })}
        </div>
      )}

      {/* Two columns: drawdown + milestone */}
      {result && (
        <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border border-b border-border">
          {/* Drawdown table */}
          <div className="p-5 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
              Drawdown Risk · Watch/Pause/Resume Tiers
            </p>
            <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
              P(drawdown exceeds threshold at any point over {horizon} years). SBR governance response per constitution.
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left pb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Tier</th>
                  <th className="text-right pb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Prob %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.ddP.map((p, i) => (
                  <tr key={i}>
                    <td className={`py-2 font-semibold ${DD_CLRS[i]}`}>
                      {DD_LBLS[i]}
                      <span className="block font-normal text-[10px] text-muted-foreground normal-case mt-0.5">{DD_GOV[i]}</span>
                    </td>
                    <td className="py-2 text-right align-top">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-12 h-1 bg-border rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.round(p * 100)}%`,
                              background: i < 2 ? '#eab308' : '#ef4444',
                            }}
                          />
                        </div>
                        <span className={`font-bold tabular-nums ${DD_CLRS[i]}`}>{(p * 100).toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Milestone heatmap */}
          <div className="p-5 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
              Milestone Probability · First-Passage
            </p>
            <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
              P(portfolio ever reaches target by year Y). Flexible horizons: 5/10/15 years.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left pb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Target</th>
                    {MSY.map(y => (
                      <th key={y} className="text-center pb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                        Yr {y}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.msP.map((row, mi) => (
                    <tr key={mi}>
                      <td className="py-1.5 pr-2 font-bold text-foreground">{MSL[mi]}</td>
                      {row.map((p, yi) => {
                        const { bg, cl } = heatCellSbr(p)
                        return (
                          <td
                            key={yi}
                            className={`text-center py-1.5 px-1 rounded font-mono font-semibold text-[11px] ${cl}`}
                            style={{ background: bg }}
                          >
                            {p < 0.005 ? '—' : `${(p * 100).toFixed(0)}%`}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Methodology footnote */}
      <div className="px-5 py-3 bg-muted/20">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          <strong>Methodology:</strong> GBM with Itô-corrected drift, monthly steps, Cholesky correlation. Asset weights
          and expected returns are sourced from the SBR constitution&apos;s fund registry; volatility and correlation are
          separate planning assumptions, not constitution requirements. A35 is the SGD anchor.
          {scenario === 0 && ' Conservative μ: blended ~6.5% p.a.'}
          {scenario === 1 && ' Base μ: blended ~8.8% p.a.'}
          {scenario === 2 && ' Aggressive μ: blended ~11.2% p.a.'}
          {' '}Flexible 5/10/15-year horizons per SBR constitution. Not a prediction or guarantee.
        </p>
      </div>
    </div>
  )
}
