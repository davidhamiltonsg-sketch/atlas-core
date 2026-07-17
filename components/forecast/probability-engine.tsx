'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { ATLAS_SPEC } from '@/lib/portfolio-spec'
import { runMC, drawFanCanvas, formatFanValue, heatCell, type AssetConfig, type MCResult } from '@/lib/gbm-engine'

// Asset weights and expected returns are sourced from ATLAS_SPEC.funds (the same governed
// registry the rest of the app uses) instead of being duplicated here — this is exactly the
// kind of drift-prone duplication that caused the SBR combined-tech-ceiling bug and the
// fabricated "Bitcoin 7/8%" look-through claim found elsewhere in the app.
const ATLAS_ASSETS: AssetConfig[] = ATLAS_SPEC.funds
  .filter((f): f is typeof f & { expectedReturn: NonNullable<typeof f.expectedReturn> } => f.expectedReturn !== undefined)
  .map(f => ({
    ticker: f.ticker,
    weight: f.target / 100,
    mu: [f.expectedReturn.conservative, f.expectedReturn.base, f.expectedReturn.aggressive],
  }))

const GREEN = '#00d68f'

// ── Component ─────────────────────────────────────────────────────────────────
const NY = 20
const MS = [1e6, 2e6, 3e6]
const MSL = ['$1M', '$2M', '$3M']
const MSY = [5, 10, 15, 19, 20]
const DD_LBLS = ['Minor (>20%)', 'Correction (>30%)', 'Severe (>40%)', 'Crisis (>50%)']
const DD_CLRS = ['text-amber-400', 'text-orange-400', 'text-red-400', 'text-red-600']
const DD_GOV = [
  'Tiers 1–2: Continue DCA, no structural change',
  'Tiers 2–3: Accelerate contributions if income permits',
  'Tier 4: Emergency review — contributions continue',
  'Tier 4–5: Full governance review, no selling without written rationale',
]

export function ProbabilityEngine({
  startValue,
  monthlyDca,
  annualBonus,
  contributionGrowthRate,
}: {
  startValue: number
  monthlyDca: number
  annualBonus: number
  contributionGrowthRate:number
}) {
  const [dca, setDca] = useState(monthlyDca)
  const [bonus, setBonus] = useState(annualBonus)
  const [sv, setSv] = useState(Math.max(0, Math.round(startValue)))
  const [scenario, setScenario] = useState(1)
  const [nPaths, setNPaths] = useState(3000)
  const [result, setResult] = useState<MCResult | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [hasRun, setHasRun] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runSim = useCallback((
    _dca: number, _bonus: number, _sv: number, _si: number, _np: number
  ) => {
    setIsRunning(true)
    setTimeout(() => {
      try {
        const r = runMC(ATLAS_ASSETS, _np, _si, _sv, NY, _dca, _bonus, contributionGrowthRate, MS, MSY)
        setResult(r)
        setHasRun(true)
      } finally {
        setIsRunning(false)
      }
    }, 20)
  }, [contributionGrowthRate])

  const scheduleRun = useCallback((
    _dca: number, _bonus: number, _sv: number, _si: number, _np: number
  ) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSim(_dca, _bonus, _sv, _si, _np), 350)
  }, [runSim])

  useEffect(() => {
    scheduleRun(dca, bonus, sv, scenario, nPaths)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [dca, bonus, sv, scenario, nPaths, scheduleRun])

  const chartOpts = useMemo(() => ({
    accentColor: GREEN,
    currencySymbol: '$',
    milestones: [
      { value: 1e6, label: '$1M', color: '#60a5fa' },
      { value: 2e6, label: '$2M', color: '#a78bfa' },
      { value: 3e6, label: '$3M', color: '#c084fc' },
    ],
    xGridStepYears: 5,
    markerYears: [19],
    markerLabels: { 19: '2045' },
  }), [])

  useEffect(() => {
    if (result && canvasRef.current) {
      drawFanCanvas(canvasRef.current, result.fan, NY, chartOpts)
    }
  }, [result, chartOpts])

  // Redraw on theme toggle or resize
  useEffect(() => {
    const obs = new ResizeObserver(() => {
      if (result && canvasRef.current) drawFanCanvas(canvasRef.current, result.fan, NY, chartOpts)
    })
    if (canvasRef.current) obs.observe(canvasRef.current)
    return () => obs.disconnect()
  }, [result, chartOpts])

  const SCENARIOS = [
    { label: 'Conservative', color: 'text-amber-400' },
    { label: 'Base Case',    color: 'text-blue-400'  },
    { label: 'Aggressive',   color: 'text-green-400' },
  ]

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">GBM Probability Engine</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Monte Carlo simulation · {nPaths.toLocaleString()} paths · {NY}-year horizon · Log-normal / Itô-corrected GBM
          </p>
        </div>
        {isRunning && (
          <span className="text-[11px] text-primary animate-pulse font-medium">Running…</span>
        )}
      </div>

      {/* Controls */}
      <div className="px-5 py-4 border-b border-border grid gap-4 sm:grid-cols-2 lg:grid-cols-4 bg-muted/20">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">
            Starting value (SGD)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range" min={0} max={500000} step={5000} value={sv}
              onChange={e => setSv(+e.target.value)}
              className="flex-1 h-1 accent-primary"
            />
            <span className="text-sm font-bold tabular-nums w-20 text-right">
              ${(sv / 1000).toFixed(0)}K
            </span>
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">
            Monthly contribution (SGD)
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {[1000, 2000, 3000, 4000, 5000].map(v => (
              <button
                key={v}
                onClick={() => setDca(v)}
                className={`text-[10px] font-bold px-2 py-1 rounded border transition-colors ${
                  dca === v
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent border-border text-muted-foreground hover:border-primary/50'
                }`}
              >
                ${(v / 1000).toFixed(0)}K
              </button>
            ))}
          </div>
          <input
            type="number" value={dca} step={100} min={0}
            onChange={e => setDca(Math.max(0, +e.target.value))}
            className="mt-1.5 w-full rounded border border-border bg-background text-sm px-2 py-1 tabular-nums"
          />
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">
            Annual lump sum (SGD)
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {[0, 10000, 20000, 30000].map(v => (
              <button
                key={v}
                onClick={() => setBonus(v)}
                className={`text-[10px] font-bold px-2 py-1 rounded border transition-colors ${
                  bonus === v
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent border-border text-muted-foreground hover:border-primary/50'
                }`}
              >
                {v === 0 ? 'None' : `$${v / 1000}K`}
              </button>
            ))}
          </div>
          <input
            type="number" value={bonus} step={1000} min={0}
            onChange={e => setBonus(Math.max(0, +e.target.value))}
            className="mt-1.5 w-full rounded border border-border bg-background text-sm px-2 py-1 tabular-nums"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">
              Return Scenario
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
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">
              Simulation Paths
            </label>
            <select
              value={nPaths}
              onChange={e => setNPaths(+e.target.value)}
              className="w-full rounded border border-border bg-background text-sm px-2 py-1"
            >
              <option value={1000}>1,000 (fast preview)</option>
              <option value={3000}>3,000 (default)</option>
              <option value={5000}>5,000 (precise)</option>
              <option value={10000}>10,000 (slow)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Fan chart */}
      <div className="px-5 py-4 border-b border-border">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Terminal Wealth Distribution · {NY}-Year Percentile Fan
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
              <span className="inline-block w-4 h-1.5 rounded" style={{ background: '#00d68f', opacity: 0.15 }} />
              P10–P90 range
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-1.5 rounded" style={{ background: '#00d68f', opacity: 0.35 }} />
              P25–P75 range
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-2" style={{ background: '#00d68f', borderRadius: 2 }} />
              P50 median
            </span>
          </div>
        )}
      </div>

      {/* Stats strip */}
      {result && (
        <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-border border-b border-border">
          {(['P10', 'P25', 'P50 Median', 'P75', 'P90', '4% Rule / mo'] as const).map((lbl, i) => {
            const v = result.fan[19]
            const vals = [v[1], v[2], v[3], v[4], v[5], v[3] * 0.04 / 12]
            const colors = ['text-muted-foreground', 'text-amber-400', 'text-blue-400', 'text-green-400', 'text-green-400', 'text-blue-400']
            return (
              <div key={lbl} className="px-3 py-2.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{lbl} · yr 19</p>
                <p className={`text-sm font-black tabular-nums mt-0.5 ${colors[i]}`}>{formatFanValue(vals[i])}</p>
              </div>
            )
          })}
        </div>
      )}

      {/* Two columns: drawdown + milestone */}
      {result && (
        <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border border-b border-border">
          {/* Drawdown table */}
          <div className="p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
              Maximum Drawdown Risk · Over {NY} Years
            </p>
            <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
              P(any peak-to-trough decline exceeds threshold at any point over {NY} years). DCA continues at all tiers per governance.
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left pb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Severity</th>
                  <th className="text-right pb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Probability</th>
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
                              background: i < 2 ? '#f59e0b' : '#f87171',
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
          <div className="p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
              Milestone Probability · First-Passage
            </p>
            <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
              P(portfolio ever reaches target by year Y). Counts any path that touches threshold by year Y.
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
                        const { bg, cl } = heatCell(p, '0,214,143')
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
          <strong>Methodology:</strong> GBM with Itô-corrected drift — S(t+Δt) = S(t)·exp[(μ−σ²/2)Δt + σ√Δt·Z], monthly steps.
          Correlated normals via Cholesky decomposition of a planning correlation matrix. Asset weights and expected
          returns are sourced from the Atlas Core constitution&apos;s fund registry; volatility and correlation are separate
          planning assumptions, not constitution requirements.
          {scenario === 0 && ' Conservative μ: blended ~7.1% p.a.'}
          {scenario === 1 && ' Base μ: blended ~10.3% p.a.'}
          {scenario === 2 && ' Aggressive μ: blended ~13.9% p.a.'}
          {' '}Not a prediction — defines the planning range.
        </p>
      </div>
    </div>
  )
}
