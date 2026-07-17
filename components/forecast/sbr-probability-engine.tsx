'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

// ── Asset configs for SBR ────────────────────────────────────────────────────
interface Asset { n: string; w: number; mu: number[]; s: number }

// SBR asset configuration (5 funds)
const SBR_ASSETS: Asset[] = [
  { n: 'A20', w: 0.20, mu: [0.05, 0.08, 0.11], s: 0.14 },
  { n: 'A35', w: 0.35, mu: [0.03, 0.05, 0.07], s: 0.08 },
  { n: 'A70', w: 0.20, mu: [0.06, 0.10, 0.14], s: 0.18 },
  { n: 'EQAC', w: 0.15, mu: [0.05, 0.105, 0.15], s: 0.23 },
  { n: 'SMH', w: 0.10, mu: [0.04, 0.115, 0.18], s: 0.30 },
]

// SBR correlation matrix (simplified for 5 funds)
const CORR_5: number[][] = [
  [1.00, 0.65, 0.85, 0.80, 0.70],
  [0.65, 1.00, 0.50, 0.45, 0.35],
  [0.85, 0.50, 1.00, 0.82, 0.75],
  [0.80, 0.45, 0.82, 1.00, 0.82],
  [0.70, 0.35, 0.75, 0.82, 1.00],
]

// ── GBM math ──────────────────────────────────────────────────────────────────
function chol(C: number[][]): number[][] {
  const n = C.length
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let j = 0; j < n; j++) {
    let s = C[j][j]
    for (let k = 0; k < j; k++) s -= L[j][k] ** 2
    L[j][j] = Math.sqrt(Math.max(s, 1e-14))
    for (let i = j + 1; i < n; i++) {
      let t = C[i][j]
      for (let k = 0; k < j; k++) t -= L[i][k] * L[j][k]
      L[i][j] = t / L[j][j]
    }
  }
  return L
}

let _sp = 0, _hs = false, _seed = 0x5a17c9e3
function random() { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296 }
function rn(): number {
  if (_hs) { _hs = false; return _sp }
  let u = 0, v = 0, s = 0
  do { u = random() * 2 - 1; v = random() * 2 - 1; s = u * u + v * v } while (s >= 1 || s === 0)
  const m = Math.sqrt(-2 * Math.log(s) / s); _sp = v * m; _hs = true; return u * m
}

function corrZ(L: number[][], n: number): number[] {
  const u = Array.from({ length: n }, rn)
  return Array.from({ length: n }, (_, r) => L[r].slice(0, r + 1).reduce((s, v, c) => s + v * u[c], 0))
}

interface MCResult {
  fan: number[][]
  ddP: number[]
  ddThr: number[]
  msP: number[][]
}

function runMC(
  assets: Asset[], nP: number, si: number, sv: number,
  NY: number, DCA: number, BONUS: number, GROWTH: number,
  MS: number[], MSY: number[]
): MCResult {
  _seed = 0x5a17c9e3; _hs = false
  const C = CORR_5, L = chol(C)
  const nA = assets.length
  const dt = 1 / 12, sdt = Math.sqrt(dt)
  const dr = assets.map(a => (a.mu[si] - 0.5 * a.s * a.s) * dt)
  const dif = assets.map(a => a.s * sdt)
  const w = assets.map(a => a.w)
  const PCTS = [5, 10, 25, 50, 75, 90]
  const ddThr = [0.20, 0.30, 0.40, 0.50]

  const yearVals: Float64Array[] = Array.from({ length: NY + 1 }, () => new Float64Array(nP))
  const maxDD = new Float64Array(nP)
  const hy = new Uint16Array(nP * MS.length).fill(999)

  for (let p = 0; p < nP; p++) {
    const pos = w.map(wi => wi * sv)
    let pval = sv, peak = sv, mdd = 0
    yearVals[0][p] = sv

    for (let yr = 0; yr < NY; yr++) {
      const annualDca = DCA * Math.pow(1 + GROWTH, yr)
      const annualBonus = BONUS * Math.pow(1 + GROWTH, yr)
      for (let mo = 0; mo < 12; mo++) {
        const z = corrZ(L, nA)
        for (let i = 0; i < nA; i++) {
          pos[i] = pos[i] * Math.exp(dr[i] + dif[i] * z[i]) + w[i] * annualDca
        }
        pval = pos.reduce((s, v) => s + v, 0)
        if (pval > peak) peak = pval
        const dd = (peak - pval) / peak; if (dd > mdd) mdd = dd
      }
      for (let i = 0; i < nA; i++) pos[i] += w[i] * annualBonus
      pval = pos.reduce((s, v) => s + v, 0)
      if (pval > peak) peak = pval
      const dd2 = (peak - pval) / peak; if (dd2 > mdd) mdd = dd2
      yearVals[yr + 1][p] = pval
      for (let mi = 0; mi < MS.length; mi++) {
        if (hy[p * MS.length + mi] === 999 && pval >= MS[mi]) hy[p * MS.length + mi] = yr + 1
      }
    }
    maxDD[p] = mdd
  }

  const fan = Array.from({ length: NY + 1 }, (_, yr) => {
    const v = Array.from(yearVals[yr]).sort((a, b) => a - b)
    return PCTS.map(pct => v[Math.min(nP - 1, Math.floor(pct / 100 * nP))])
  })

  const ddP = ddThr.map(t => Array.from(maxDD).filter(d => d > t).length / nP)
  const msP = MS.map((_, mi) => MSY.map(ty => {
    let c = 0; for (let p = 0; p < nP; p++) if (hy[p * MS.length + mi] <= ty) c++; return c / nP
  }))

  return { fan, ddP, ddThr, msP }
}

// ── Canvas fan chart for SBR ──────────────────────────────────────────────────
function fmtV(v: number) {
  if (v >= 1e6) return 'S$' + (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return 'S$' + (v / 1e3).toFixed(0) + 'K'
  return 'S$' + v.toFixed(0)
}

function niceMax(v: number) {
  const e = Math.pow(10, Math.floor(Math.log10(v || 1)))
  return Math.ceil((v || 1) / e) * e
}

function drawFanCanvas(canvas: HTMLCanvasElement, fan: number[][], NY: number) {
  const dpr = window.devicePixelRatio || 1
  const W = canvas.offsetWidth || 680
  const H = canvas.offsetHeight || 280
  canvas.width = W * dpr; canvas.height = H * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)

  const isDark = document.documentElement.dataset.theme === 'dark' ||
    (document.documentElement.dataset.theme !== 'light' && window.matchMedia('(prefers-color-scheme:dark)').matches)

  const gridClr = isDark ? '#1e2d40' : '#e2e8f0'
  const textClr = isDark ? '#64748b' : '#94a3b8'
  const cyan = '#06b6d4'
  const MS_COLORS = ['#22d3ee', '#a78bfa', '#c084fc']
  const MS_VALS = [500_000, 1_000_000, 1_500_000]
  const MS_LBLS = ['S$500K', 'S$1M', 'S$1.5M']

  const P = { t: 14, r: 58, b: 38, l: 76 }
  const pw = W - P.l - P.r, ph = H - P.t - P.b
  const yMax = niceMax(fan[NY][5])
  const x = (yr: number) => P.l + (yr / NY) * pw
  const y = (v: number) => H - P.b - (v / yMax) * ph

  ctx.clearRect(0, 0, W, H)

  // y-grid
  const step = niceMax(yMax / 6)
  for (let v = step; v <= yMax * 1.001; v += step) {
    const yv = y(v)
    ctx.strokeStyle = gridClr; ctx.lineWidth = 1; ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(P.l, yv); ctx.lineTo(W - P.r, yv); ctx.stroke()
    ctx.fillStyle = textClr; ctx.font = '10px monospace'; ctx.textAlign = 'right'
    ctx.fillText(fmtV(v), P.l - 5, yv + 4)
  }

  // x-grid (every year)
  for (let yr = 0; yr <= NY; yr++) {
    const xv = x(yr)
    if (yr % 5 === 0 || yr <= NY) {
      ctx.strokeStyle = gridClr; ctx.lineWidth = 1; ctx.setLineDash([])
      ctx.beginPath(); ctx.moveTo(xv, P.t); ctx.lineTo(xv, H - P.b); ctx.stroke()
      ctx.fillStyle = textClr; ctx.font = '10px monospace'; ctx.textAlign = 'center'
      ctx.fillText(String(2026 + yr), xv, H - P.b + 14)
    }
  }

  // Milestone dashes
  MS_VALS.forEach((mv, i) => {
    if (mv > yMax * 1.02) return
    const yv = y(mv)
    ctx.strokeStyle = MS_COLORS[i]; ctx.lineWidth = 1; ctx.setLineDash([5, 4])
    ctx.globalAlpha = 0.55
    ctx.beginPath(); ctx.moveTo(P.l, yv); ctx.lineTo(W - P.r, yv); ctx.stroke()
    ctx.globalAlpha = 1; ctx.setLineDash([])
    ctx.fillStyle = MS_COLORS[i]; ctx.font = '9px monospace'; ctx.textAlign = 'left'
    ctx.fillText(MS_LBLS[i], W - P.r + 3, yv + 4)
  })

  // Fill bands (P10-P90, P25-P75)
  const fillBand = (iL: number, iH: number, alpha: number) => {
    ctx.beginPath()
    ctx.moveTo(x(0), y(fan[0][iH]))
    for (let yr = 1; yr <= NY; yr++) ctx.lineTo(x(yr), y(fan[yr][iH]))
    for (let yr = NY; yr >= 0; yr--) ctx.lineTo(x(yr), y(fan[yr][iL]))
    ctx.closePath()
    ctx.fillStyle = cyan; ctx.globalAlpha = alpha; ctx.fill(); ctx.globalAlpha = 1
  }
  fillBand(1, 4, 0.10)
  fillBand(2, 3, 0.22)

  // Lines (P10, P25, P75, P90, P50)
  const drawLine = (idx: number, alpha: number, width: number, dash: number[] = []) => {
    ctx.beginPath(); ctx.moveTo(x(0), y(fan[0][idx]))
    for (let yr = 1; yr <= NY; yr++) ctx.lineTo(x(yr), y(fan[yr][idx]))
    ctx.strokeStyle = cyan; ctx.lineWidth = width; ctx.globalAlpha = alpha
    ctx.setLineDash(dash); ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([])
  }
  drawLine(0, 0.18, 1, [3, 4])
  drawLine(5, 0.18, 1, [3, 4])
  drawLine(1, 0.45, 1)
  drawLine(4, 0.45, 1)
  drawLine(3, 1.0, 2.5)

  // Terminal markers
  const showYear = (yr: number) => {
    const xv = x(yr)
    const y50 = y(fan[yr][3])
    const y10 = y(fan[yr][1])
    const y90 = y(fan[yr][5])
    ctx.strokeStyle = cyan; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.globalAlpha = 0.28
    ctx.beginPath(); ctx.moveTo(xv, y10); ctx.lineTo(xv, y90); ctx.stroke()
    ctx.setLineDash([]); ctx.globalAlpha = 1
    ctx.beginPath(); ctx.arc(xv, y50, 4, 0, Math.PI * 2)
    ctx.fillStyle = cyan; ctx.fill()
  }

  if (NY >= 5) showYear(5)
  if (NY >= 10) showYear(10)
  if (NY >= 15) showYear(15)
}

// ── Component ─────────────────────────────────────────────────────────────────
const NY_HORIZONS = { 5: 5, 10: 10, 15: 15 }
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

function heatCell(p: number) {
  if (p < 0.01) return { bg: 'transparent', cl: 'text-muted-foreground' }
  if (p < 0.15) return { bg: `rgba(248,113,113,${(0.08 + p * 0.55).toFixed(2)})`, cl: 'text-foreground' }
  if (p < 0.45) return { bg: `rgba(245,158,11,${(0.1 + p * 0.45).toFixed(2)})`, cl: 'text-foreground' }
  return { bg: `rgba(6,182,212,${(0.12 + p * 0.5).toFixed(2)})`, cl: 'text-foreground font-bold' }
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

  useEffect(() => {
    if (result && canvasRef.current) {
      drawFanCanvas(canvasRef.current, result.fan, horizon)
    }
  }, [result, horizon])

  useEffect(() => {
    const obs = new ResizeObserver(() => {
      if (result && canvasRef.current) drawFanCanvas(canvasRef.current, result.fan, horizon)
    })
    if (canvasRef.current) obs.observe(canvasRef.current)
    return () => obs.disconnect()
  }, [result, horizon])

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
                <p className={`text-sm font-black tabular-nums mt-0.5 ${colors[i]}`}>{fmtV(vals[i])}</p>
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
                    <td className={`py-2 font-semibold ${DD_CLRS[i]}`}>{DD_LBLS[i]}</td>
                    <td className="py-2 text-right">
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
            <div className="mt-4 p-3 rounded-lg bg-cyan-500/[0.08] border border-cyan-500/20">
              <p className="text-[11px] text-muted-foreground leading-relaxed font-medium">
                <span className="text-cyan-400">Governance response:</span> Minor/Correction = watch carefully. Severe/Crisis = pause contributions, formal review.
              </p>
            </div>
          </div>

          {/* Milestone heatmap */}
          <div className="p-5">
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
                        const { bg, cl } = heatCell(p)
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
          <strong>Methodology:</strong> GBM with monthly steps, Cholesky correlation. SBR assets: A20/A35/A70 (SGD anchors) + EQAC/SMH (growth).
          {scenario === 0 && ' Conservative μ: blended ~6% p.a.'}
          {scenario === 1 && ' Base μ: blended ~8.5% p.a.'}
          {scenario === 2 && ' Aggressive μ: blended ~11% p.a.'}
          {' '}Flexible 5/10/15-year horizons per SBR constitution. Not a prediction or guarantee.
        </p>
      </div>
    </div>
  )
}
