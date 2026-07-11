'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

// ── Asset configs ────────────────────────────────────────────────────────────
interface Asset { n: string; w: number; mu: number[]; s: number }

const ATLAS_ASSETS: Asset[] = [
  { n: 'VWRA', w: 0.52, mu: [0.0585, 0.0935, 0.1185], s: 0.15 },
  { n: 'EQQQ', w: 0.23, mu: [0.0682, 0.1132, 0.1582], s: 0.22 },
  { n: 'SEMI', w: 0.10, mu: [0.0596, 0.1296, 0.1996], s: 0.32 },
  { n: 'VFEA', w: 0.08, mu: [0.0286, 0.0636, 0.0986], s: 0.18 },
  { n: 'IBIT', w: 0.05, mu: [-0.05,  0.12,   0.25  ], s: 0.70 },
]

// 5×5 empirical correlation matrix (VWRA/EQQQ/SEMI/VFEA/IBIT, 2014–2024)
const CORR_5: number[][] = [
  [1.00, 0.87, 0.78, 0.82, 0.18],
  [0.87, 1.00, 0.88, 0.72, 0.22],
  [0.78, 0.88, 1.00, 0.68, 0.24],
  [0.82, 0.72, 0.68, 1.00, 0.14],
  [0.18, 0.22, 0.24, 0.14, 1.00],
]
// CIDX maps both UCITS tickers (VWRA/EQQQ/SEMI/VFEA) and their legacy US equivalents
// (VT/QQQM/SMH/VWO) to the same correlation column — kept for backward data compatibility
// so historical snapshots with old tickers still resolve to the correct matrix index.
const CIDX: Record<string, number> = {
  VWRA: 0, VT: 0, EQQQ: 1, QQQM: 1, SEMI: 2, SMH: 2, VFEA: 3, VWO: 3, IBIT: 4, BTC: 4,
}

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

let _sp = 0, _hs = false
function rn(): number {
  if (_hs) { _hs = false; return _sp }
  let u = 0, v = 0, s = 0
  do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v } while (s >= 1 || s === 0)
  const m = Math.sqrt(-2 * Math.log(s) / s); _sp = v * m; _hs = true; return u * m
}

function corrZ(L: number[][], n: number): number[] {
  const u = Array.from({ length: n }, rn)
  return Array.from({ length: n }, (_, r) => L[r].slice(0, r + 1).reduce((s, v, c) => s + v * u[c], 0))
}

function buildCorr(assets: Asset[]): number[][] {
  const n = assets.length
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      const ci = CIDX[assets[i].n] ?? 0
      const cj = CIDX[assets[j].n] ?? 0
      if (ci < 5 && cj < 5) return CORR_5[ci][cj]
      return i === j ? 1 : 0.08
    })
  )
}

interface MCResult {
  fan: number[][]
  ddP: number[]
  ddThr: number[]
  msP: number[][]
}

function runMC(
  assets: Asset[], nP: number, si: number, sv: number,
  NY: number, DCA: number, BONUS: number,
  MS: number[], MSY: number[]
): MCResult {
  const C = buildCorr(assets), L = chol(C)
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
      for (let mo = 0; mo < 12; mo++) {
        const z = corrZ(L, nA)
        for (let i = 0; i < nA; i++) {
          pos[i] = pos[i] * Math.exp(dr[i] + dif[i] * z[i]) + w[i] * DCA
        }
        pval = pos.reduce((s, v) => s + v, 0)
        if (pval > peak) peak = pval
        const dd = (peak - pval) / peak; if (dd > mdd) mdd = dd
      }
      for (let i = 0; i < nA; i++) pos[i] += w[i] * BONUS
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

// ── Canvas fan chart ──────────────────────────────────────────────────────────
function fmtV(v: number) {
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K'
  return '$' + v.toFixed(0)
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
  const green = '#00d68f'
  const MS_COLORS = ['#60a5fa', '#a78bfa', '#c084fc']
  const MS_VALS = [1e6, 2e6, 3e6]
  const MS_LBLS = ['$1M', '$2M', '$3M']

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

  // x-grid (every 5 years)
  for (let yr = 0; yr <= NY; yr += 5) {
    const xv = x(yr)
    ctx.strokeStyle = gridClr; ctx.lineWidth = 1; ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(xv, P.t); ctx.lineTo(xv, H - P.b); ctx.stroke()
    ctx.fillStyle = textClr; ctx.font = '10px monospace'; ctx.textAlign = 'center'
    ctx.fillText(String(2026 + yr), xv, H - P.b + 14)
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
    ctx.fillStyle = green; ctx.globalAlpha = alpha; ctx.fill(); ctx.globalAlpha = 1
  }
  fillBand(1, 4, 0.10)
  fillBand(2, 3, 0.22)

  // Lines (P10, P25, P75, P90, P50)
  const drawLine = (idx: number, alpha: number, width: number, dash: number[] = []) => {
    ctx.beginPath(); ctx.moveTo(x(0), y(fan[0][idx]))
    for (let yr = 1; yr <= NY; yr++) ctx.lineTo(x(yr), y(fan[yr][idx]))
    ctx.strokeStyle = green; ctx.lineWidth = width; ctx.globalAlpha = alpha
    ctx.setLineDash(dash); ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([])
  }
  drawLine(0, 0.18, 1, [3, 4])
  drawLine(5, 0.18, 1, [3, 4])
  drawLine(1, 0.45, 1)
  drawLine(4, 0.45, 1)
  drawLine(3, 1.0, 2.5)

  // 2045 marker
  const x19 = x(NY === 20 ? 19 : NY)
  const y50 = y(fan[NY === 20 ? 19 : NY][3])
  const y10 = y(fan[NY === 20 ? 19 : NY][1])
  const y90 = y(fan[NY === 20 ? 19 : NY][5])
  ctx.strokeStyle = green; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.globalAlpha = 0.28
  ctx.beginPath(); ctx.moveTo(x19, y10); ctx.lineTo(x19, y90); ctx.stroke()
  ctx.setLineDash([]); ctx.globalAlpha = 1
  ctx.beginPath(); ctx.arc(x19, y50, 4, 0, Math.PI * 2)
  ctx.fillStyle = green; ctx.fill()
  ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = green
  ctx.fillText('2045', x19, y50 - 9)
}

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

function heatCell(p: number) {
  if (p < 0.01) return { bg: 'transparent', cl: 'text-muted-foreground' }
  if (p < 0.15) return { bg: `rgba(248,113,113,${(0.08 + p * 0.55).toFixed(2)})`, cl: 'text-foreground' }
  if (p < 0.45) return { bg: `rgba(245,158,11,${(0.1 + p * 0.45).toFixed(2)})`,   cl: 'text-foreground' }
  return { bg: `rgba(0,214,143,${(0.12 + p * 0.5).toFixed(2)})`, cl: 'text-foreground font-bold' }
}

export function ProbabilityEngine({
  startValue,
  monthlyDca,
  annualBonus,
}: {
  startValue: number
  monthlyDca: number
  annualBonus: number
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
        const r = runMC(ATLAS_ASSETS, _np, _si, _sv, NY, _dca, _bonus, MS, MSY)
        setResult(r)
        setHasRun(true)
      } finally {
        setIsRunning(false)
      }
    }, 20)
  }, [])

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

  useEffect(() => {
    if (result && canvasRef.current) {
      drawFanCanvas(canvasRef.current, result.fan, NY)
    }
  }, [result])

  // Redraw on theme toggle or resize
  useEffect(() => {
    const obs = new ResizeObserver(() => {
      if (result && canvasRef.current) drawFanCanvas(canvasRef.current, result.fan, NY)
    })
    if (canvasRef.current) obs.observe(canvasRef.current)
    return () => obs.disconnect()
  }, [result])

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
            Starting Value (USD)
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
            Monthly DCA (USD)
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
            Annual Bonus (USD)
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
                    <td className={`py-2 font-semibold ${DD_CLRS[i]}`}>{DD_LBLS[i]}</td>
                    <td className="py-2 text-right">
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
          <strong>Methodology:</strong> GBM with Itô-corrected drift — S(t+Δt) = S(t)·exp[(μ−σ²/2)Δt + σ√Δt·Z], monthly steps.
          Correlated normals via Cholesky decomposition of the 2014–2024 empirical 5×5 correlation matrix.
          Asset config: VWRA 54% (σ=15%), EQQQ 23% (σ=22%), SEMI 10% (σ=32%), VFEA 8% (σ=18%), Bitcoin sleeve 5% (σ=70%).
          {scenario === 0 && ' Conservative μ: blended ~7.1% p.a.'}
          {scenario === 1 && ' Base μ: blended ~10.3% p.a.'}
          {scenario === 2 && ' Aggressive μ: blended ~13.9% p.a.'}
          {' '}Not a prediction — defines the planning range.
        </p>
      </div>
    </div>
  )
}
