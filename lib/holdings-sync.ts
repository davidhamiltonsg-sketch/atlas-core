import { db } from "@/lib/db"
import { CORE_TICKERS } from "@/lib/approved-alternatives"

// Default metadata for the governed core tickers, used to create any that are missing so the
// plan is always represented (e.g. IBIT and SGOV, added to the plan after the DB was seeded).
const CORE_DEFAULTS: Record<string, { name: string; targetPct: number; hardCapPct: number | null; toleranceBand: number; color: string }> = {
  VT:   { name: "Vanguard Total World Stock ETF",        targetPct: 52, hardCapPct: 62,   toleranceBand: 3,   color: "#818cf8" },
  VWO:  { name: "Vanguard FTSE Emerging Markets ETF",    targetPct: 8,  hardCapPct: 13,   toleranceBand: 3,   color: "#c4b5fd" },
  QQQM: { name: "Invesco NASDAQ 100 ETF",                targetPct: 23, hardCapPct: 31,   toleranceBand: 2.5, color: "#a78bfa" },
  SMH:  { name: "VanEck Semiconductor ETF",              targetPct: 10, hardCapPct: 12,   toleranceBand: 2.5, color: "#f472b6" },
  BTC:  { name: "Grayscale Bitcoin Mini ETF",            targetPct: 7,  hardCapPct: 8,    toleranceBand: 1,   color: "#f59e0b" },
  IBIT: { name: "iShares Bitcoin Trust ETF",             targetPct: 0,  hardCapPct: 8,    toleranceBand: 1,   color: "#f59e0b" },
  SGOV: { name: "iShares 0-3 Month Treasury Bond ETF",   targetPct: 0,  hardCapPct: null, toleranceBand: 2.5, color: "#10b981" },
}

/**
 * Make sure every governed core ticker exists as a holding (creating any gaps at 0 units).
 * Idempotent — only creates what is missing. Keeps the plan fully represented on the
 * dashboard/governance pages even if the DB was seeded before a ticker was added to the plan.
 */
export async function ensureCoreHoldings(userId: string): Promise<number> {
  let created = 0
  for (const ticker of CORE_TICKERS) {
    const existing = await db.holding.findFirst({ where: { userId, ticker } })
    if (existing) continue
    const d = CORE_DEFAULTS[ticker] ?? { name: ticker, targetPct: 0, hardCapPct: null, toleranceBand: 2.5, color: "#64748b" }
    const h = await db.holding.create({ data: { userId, ticker, ...d } })
    await upsertSnapshotToday(h.id, { units: 0, price: 0, value: 0 })
    created++
  }
  return created
}

const YF = "https://query1.finance.yahoo.com/v8/finance/chart/USDSGD=X?interval=1d&range=1d"

/**
 * Write at most ONE snapshot per holding per day. If today's snapshot exists, update it
 * in place; otherwise create one. Keeps the value-history chart and the DB clean instead
 * of accumulating dozens of intraday rows from refresh-on-open.
 */
export async function upsertSnapshotToday(
  holdingId: string,
  data: { units: number; price: number; value: number },
): Promise<void> {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const existing = await db.snapshot.findFirst({
    where: { holdingId, date: { gte: startOfDay } },
    orderBy: { date: "desc" },
  })
  if (existing) {
    await db.snapshot.update({
      where: { id: existing.id },
      data: { ...data, currency: "SGD", date: new Date() },
    })
  } else {
    await db.snapshot.create({
      data: { holdingId, ...data, currency: "SGD", date: new Date() },
    })
  }
}

export async function getUsdSgdRate(): Promise<number> {
  try {
    const res = await fetch(YF, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" })
    if (res.ok) {
      const d = await res.json()
      const rate = d?.chart?.result?.[0]?.meta?.regularMarketPrice
      if (rate && rate > 0) return rate
    }
  } catch {}
  return 1.35
}

/**
 * Make a holding reflect the trade log so every buy/sell feeds through the whole app.
 *
 * Net units for a ticker = Σ BUY units − Σ SELL units across ALL recorded trades. Creates the
 * holding if it's a new ticker (e.g. IBIT), then writes a fresh now-dated snapshot so the unit
 * count and value propagate to the dashboard, portfolio, governance caps, allocations, reports
 * and YTD. Idempotent: derives from the full trade log, so it stays correct after edits/deletes.
 */
export async function syncHoldingFromTrades(userId: string, ticker: string, fxRate?: number): Promise<void> {
  const fx = fxRate ?? (await getUsdSgdRate())
  const sym = ticker.toUpperCase()

  const trades = await db.trade.findMany({ where: { userId, ticker: sym }, orderBy: { date: "asc" } })
  const netUnits = Math.max(0, trades.reduce((s, t) => s + (t.type === "BUY" ? t.units : -t.units), 0))

  let holding = await db.holding.findFirst({ where: { userId, ticker: sym } })
  if (!holding) {
    if (netUnits <= 0) return
    holding = await db.holding.create({
      data: { userId, ticker: sym, name: sym, targetPct: 0, hardCapPct: null, toleranceBand: 2.5, color: "#64748b" },
    })
  }

  const latest = await db.snapshot.findFirst({ where: { holdingId: holding.id }, orderBy: { date: "desc" } })
  const lastTradePrice = trades.length ? trades[trades.length - 1].price : 0
  const markPrice = latest?.price && latest.price > 0 ? latest.price : lastTradePrice

  await upsertSnapshotToday(holding.id, { units: netUnits, price: markPrice, value: netUnits * markPrice * fx })
}
