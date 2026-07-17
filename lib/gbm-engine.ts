// Shared GBM Monte Carlo engine for the Atlas Core and Silicon Brick Road probability
// engines. Previously this math (Cholesky decomposition, seeded RNG, correlated draws, the
// simulation loop, and the canvas fan-chart renderer) was duplicated near-verbatim across
// components/forecast/probability-engine.tsx and sbr-probability-engine.tsx — ~500 lines each,
// free to silently diverge the same way the SBR combined-tech-ceiling and "Bitcoin 7/8%"
// figures drifted earlier. This module is the single source for that math; each portfolio's
// component supplies only its own asset weights (sourced from portfolio-spec.ts) and UI.

export interface AssetConfig {
  ticker: string
  weight: number
  mu: [number, number, number] // [conservative, base, aggressive] expected annual return
}

export interface MCResult {
  fan: number[][]
  ddP: number[]
  ddThr: number[]
  msP: number[][]
}

export interface Milestone {
  value: number
  label: string
  color: string
}

// ── Planning-assumption market data ─────────────────────────────────────────────
// Volatility and pairwise correlation are explicit external planning inputs, not
// constitution-governed thresholds (those live in lib/portfolio-spec.ts) — kept here once
// instead of duplicated per engine. A ticker missing from ASSET_CORRELATION correlates at
// 0.08 with everything except itself (matches the previous engines' fallback for new tickers).
export const ASSET_VOLATILITY: Record<string, number> = {
  VWRA: 0.16, EQAC: 0.23, SMH: 0.30, BTC: 0.70, DBMFE: 0.135, A35: 0.08,
}

export const ASSET_CORRELATION: Record<string, Record<string, number>> = {
  VWRA:  { VWRA: 1.00, EQAC: 0.88, SMH: 0.78, BTC: 0.30, DBMFE: 0.00, A35: 0.30 },
  EQAC:  { VWRA: 0.88, EQAC: 1.00, SMH: 0.82, BTC: 0.35, DBMFE: 0.00, A35: 0.15 },
  SMH:   { VWRA: 0.78, EQAC: 0.82, SMH: 1.00, BTC: 0.35, DBMFE: 0.00, A35: 0.10 },
  BTC:   { VWRA: 0.30, EQAC: 0.35, SMH: 0.35, BTC: 1.00, DBMFE: 0.00, A35: 0.05 },
  DBMFE: { VWRA: 0.00, EQAC: 0.00, SMH: 0.00, BTC: 0.00, DBMFE: 1.00, A35: 0.00 },
  A35:   { VWRA: 0.30, EQAC: 0.15, SMH: 0.10, BTC: 0.05, DBMFE: 0.00, A35: 1.00 },
}

function buildCorrelationMatrix(tickers: string[]): number[][] {
  return tickers.map(a =>
    tickers.map(b => (a === b ? 1 : ASSET_CORRELATION[a]?.[b] ?? 0.08))
  )
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

// Deterministic seeded RNG so the same inputs reproduce the same fan chart between renders
// (no flicker as the user drags a slider) — reset at the start of every runMC call.
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

const DD_THRESHOLDS = [0.20, 0.30, 0.40, 0.50]

export function runMC(
  assets: AssetConfig[], nPaths: number, scenarioIdx: number, startValue: number,
  years: number, monthlyDca: number, annualBonus: number, contributionGrowth: number,
  milestoneValues: number[], milestoneYears: number[],
): MCResult {
  _seed = 0x5a17c9e3; _hs = false
  const tickers = assets.map(a => a.ticker)
  const L = chol(buildCorrelationMatrix(tickers))
  const nA = assets.length
  const dt = 1 / 12, sdt = Math.sqrt(dt)
  const sigma = assets.map(a => ASSET_VOLATILITY[a.ticker] ?? 0.20)
  const dr = assets.map((a, i) => (a.mu[scenarioIdx] - 0.5 * sigma[i] * sigma[i]) * dt)
  const dif = sigma.map(s => s * sdt)
  const w = assets.map(a => a.weight)
  const PCTS = [5, 10, 25, 50, 75, 90]

  const yearVals: Float64Array[] = Array.from({ length: years + 1 }, () => new Float64Array(nPaths))
  const maxDD = new Float64Array(nPaths)
  const hy = new Uint16Array(nPaths * milestoneValues.length).fill(999)

  for (let p = 0; p < nPaths; p++) {
    const pos = w.map(wi => wi * startValue)
    let pval = startValue, peak = startValue, mdd = 0
    yearVals[0][p] = startValue

    for (let yr = 0; yr < years; yr++) {
      const annualDca = monthlyDca * Math.pow(1 + contributionGrowth, yr)
      const bonus = annualBonus * Math.pow(1 + contributionGrowth, yr)
      for (let mo = 0; mo < 12; mo++) {
        const z = corrZ(L, nA)
        for (let i = 0; i < nA; i++) {
          pos[i] = pos[i] * Math.exp(dr[i] + dif[i] * z[i]) + w[i] * annualDca
        }
        pval = pos.reduce((s, v) => s + v, 0)
        if (pval > peak) peak = pval
        const dd = (peak - pval) / peak; if (dd > mdd) mdd = dd
      }
      for (let i = 0; i < nA; i++) pos[i] += w[i] * bonus
      pval = pos.reduce((s, v) => s + v, 0)
      if (pval > peak) peak = pval
      const dd2 = (peak - pval) / peak; if (dd2 > mdd) mdd = dd2
      yearVals[yr + 1][p] = pval
      for (let mi = 0; mi < milestoneValues.length; mi++) {
        if (hy[p * milestoneValues.length + mi] === 999 && pval >= milestoneValues[mi]) hy[p * milestoneValues.length + mi] = yr + 1
      }
    }
    maxDD[p] = mdd
  }

  const fan = Array.from({ length: years + 1 }, (_, yr) => {
    const v = Array.from(yearVals[yr]).sort((a, b) => a - b)
    return PCTS.map(pct => v[Math.min(nPaths - 1, Math.floor(pct / 100 * nPaths))])
  })

  const ddP = DD_THRESHOLDS.map(t => Array.from(maxDD).filter(d => d > t).length / nPaths)
  const msP = milestoneValues.map((_, mi) => milestoneYears.map(ty => {
    let c = 0; for (let p = 0; p < nPaths; p++) if (hy[p * milestoneValues.length + mi] <= ty) c++; return c / nPaths
  }))

  return { fan, ddP, ddThr: DD_THRESHOLDS, msP }
}

// ── Formatting ──────────────────────────────────────────────────────────────────
export function formatFanValue(v: number, currencySymbol = '$'): string {
  if (v >= 1e6) return currencySymbol + (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return currencySymbol + (v / 1e3).toFixed(0) + 'K'
  return currencySymbol + v.toFixed(0)
}

function niceMax(v: number): number {
  const e = Math.pow(10, Math.floor(Math.log10(v || 1)))
  return Math.ceil((v || 1) / e) * e
}

export function heatCell(p: number, positiveRgb: string): { bg: string; cl: string } {
  if (p < 0.01) return { bg: 'transparent', cl: 'text-muted-foreground' }
  if (p < 0.15) return { bg: `rgba(248,113,113,${(0.08 + p * 0.55).toFixed(2)})`, cl: 'text-foreground' }
  if (p < 0.45) return { bg: `rgba(245,158,11,${(0.1 + p * 0.45).toFixed(2)})`, cl: 'text-foreground' }
  return { bg: `rgba(${positiveRgb},${(0.12 + p * 0.5).toFixed(2)})`, cl: 'text-foreground font-bold' }
}

// ── Canvas fan chart ──────────────────────────────────────────────────────────
export interface FanChartOptions {
  accentColor: string
  currencySymbol: string
  milestones: Milestone[]
  xGridStepYears: number
  markerYears: number[]
  markerLabels?: Record<number, string>
  startYear?: number
}

export function drawFanCanvas(canvas: HTMLCanvasElement, fan: number[][], years: number, opts: FanChartOptions) {
  const { accentColor, currencySymbol, milestones, xGridStepYears, markerYears, markerLabels, startYear = 2026 } = opts
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

  const P = { t: 14, r: 58, b: 38, l: 76 }
  const pw = W - P.l - P.r, ph = H - P.t - P.b
  const yMax = niceMax(fan[years][5])
  const x = (yr: number) => P.l + (yr / years) * pw
  const y = (v: number) => H - P.b - (v / yMax) * ph

  ctx.clearRect(0, 0, W, H)

  // y-grid
  const step = niceMax(yMax / 6)
  for (let v = step; v <= yMax * 1.001; v += step) {
    const yv = y(v)
    ctx.strokeStyle = gridClr; ctx.lineWidth = 1; ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(P.l, yv); ctx.lineTo(W - P.r, yv); ctx.stroke()
    ctx.fillStyle = textClr; ctx.font = '10px monospace'; ctx.textAlign = 'right'
    ctx.fillText(formatFanValue(v, currencySymbol), P.l - 5, yv + 4)
  }

  // x-grid, every xGridStepYears
  for (let yr = 0; yr <= years; yr += xGridStepYears) {
    const xv = x(yr)
    ctx.strokeStyle = gridClr; ctx.lineWidth = 1; ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(xv, P.t); ctx.lineTo(xv, H - P.b); ctx.stroke()
    ctx.fillStyle = textClr; ctx.font = '10px monospace'; ctx.textAlign = 'center'
    ctx.fillText(String(startYear + yr), xv, H - P.b + 14)
  }

  // Milestone dashes
  milestones.forEach(m => {
    if (m.value > yMax * 1.02) return
    const yv = y(m.value)
    ctx.strokeStyle = m.color; ctx.lineWidth = 1; ctx.setLineDash([5, 4])
    ctx.globalAlpha = 0.55
    ctx.beginPath(); ctx.moveTo(P.l, yv); ctx.lineTo(W - P.r, yv); ctx.stroke()
    ctx.globalAlpha = 1; ctx.setLineDash([])
    ctx.fillStyle = m.color; ctx.font = '9px monospace'; ctx.textAlign = 'left'
    ctx.fillText(m.label, W - P.r + 3, yv + 4)
  })

  // Fill bands (P10-P90, P25-P75)
  const fillBand = (iL: number, iH: number, alpha: number) => {
    ctx.beginPath()
    ctx.moveTo(x(0), y(fan[0][iH]))
    for (let yr = 1; yr <= years; yr++) ctx.lineTo(x(yr), y(fan[yr][iH]))
    for (let yr = years; yr >= 0; yr--) ctx.lineTo(x(yr), y(fan[yr][iL]))
    ctx.closePath()
    ctx.fillStyle = accentColor; ctx.globalAlpha = alpha; ctx.fill(); ctx.globalAlpha = 1
  }
  fillBand(1, 4, 0.10)
  fillBand(2, 3, 0.22)

  // Lines (P10, P25, P75, P90, P50)
  const drawLine = (idx: number, alpha: number, width: number, dash: number[] = []) => {
    ctx.beginPath(); ctx.moveTo(x(0), y(fan[0][idx]))
    for (let yr = 1; yr <= years; yr++) ctx.lineTo(x(yr), y(fan[yr][idx]))
    ctx.strokeStyle = accentColor; ctx.lineWidth = width; ctx.globalAlpha = alpha
    ctx.setLineDash(dash); ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([])
  }
  drawLine(0, 0.18, 1, [3, 4])
  drawLine(5, 0.18, 1, [3, 4])
  drawLine(1, 0.45, 1)
  drawLine(4, 0.45, 1)
  drawLine(3, 1.0, 2.5)

  // Percentile markers at the given years (e.g. a single terminal-year marker for Atlas,
  // several waypoint markers for SBR's flexible horizon)
  markerYears.forEach(yr => {
    const xv = x(yr)
    const y50 = y(fan[yr][3]), y10 = y(fan[yr][1]), y90 = y(fan[yr][5])
    ctx.strokeStyle = accentColor; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.globalAlpha = 0.28
    ctx.beginPath(); ctx.moveTo(xv, y10); ctx.lineTo(xv, y90); ctx.stroke()
    ctx.setLineDash([]); ctx.globalAlpha = 1
    ctx.beginPath(); ctx.arc(xv, y50, 4, 0, Math.PI * 2)
    ctx.fillStyle = accentColor; ctx.fill()
    const label = markerLabels?.[yr]
    if (label) {
      ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = accentColor
      ctx.fillText(label, xv, y50 - 9)
    }
  })
}
