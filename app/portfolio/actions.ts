"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { fetchFlexPositions } from "@/lib/ibkr-flex"
import { upsertSnapshotToday, ensureCoreHoldings, ensureSbrPresentation } from "@/lib/holdings-sync"
import { ibkrCredentialsFor } from "@/lib/ibkr-config"
import { activePortfolioContext } from "@/lib/active-portfolio"
import Anthropic from "@anthropic-ai/sdk"
import { SBR_SPEC, ATLAS_SPEC } from "@/lib/portfolio-spec"
import { assertCanMutateOwner } from "@/lib/mutation-auth"
import { economicSleeveTicker } from "@/lib/instrument-identity"
import { GOVERNANCE_UNIVERSE } from "@/lib/approved-alternatives"
import { valueConsistentPrice } from "@/lib/unit-price"
import { findDuplicateGroups } from "@/lib/holding-duplicates"
import { getCachedUsdSgdRate } from "@/lib/fx-cache"

// Yahoo Finance ticker overrides for non-US instruments held by SBR users.
const YF_TICKER_MAP: Record<string, string> = { VWRA: "VWRA.L", EQAC: "EQAC.L", SMH: "SMH.L", IBIT: "IBIT", BTC: "IBIT", DBMFE: "DBMFE.PA" }
const YF_REVERSE_MAP = Object.fromEntries(Object.entries(YF_TICKER_MAP).map(([k, v]) => [v, k]))
// Tickers whose Yahoo Finance price is already in SGD (no USD→SGD conversion needed).
const YF_SGD_PRICED = new Set<string>()

const YF_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]

// Manual update: create new snapshots for one or more holdings.
// Pass currency: "SGD" for an SGD-priced instrument to skip USD→SGD conversion.
export async function updateHoldingsManually(
  updates: Array<{ holdingId: string; units: number; price: number; currency?: "USD" | "SGD" }>
) {
  const session = await getSession()
  if (!session) throw new Error("Unauthenticated")
  const active = await activePortfolioContext(session)
  assertCanMutateOwner(session, active.owner.id)

  const usdSgdRate = await getCachedUsdSgdRate()

  for (const u of updates) {
    // Verify holding belongs to this user
    const holding = await db.holding.findFirst({
      where: { id: u.holdingId, userId: active.owner.id },
    })
    if (!holding) continue

    const fxMultiplier = u.currency === "SGD" ? 1 : usdSgdRate
    await db.snapshot.create({
      data: {
        holdingId: u.holdingId,
        units: u.units,
        price: u.price,
        value: u.units * u.price * fxMultiplier,
        currency: "SGD",
        date: new Date(),
      },
    })
  }

  revalidatePath("/portfolio")
  revalidatePath("/")
  revalidatePath("/reports")
  revalidatePath("/forecast")
  revalidatePath("/risk")
  revalidatePath("/mission-control")
}

// Apply screenshot-extracted holdings: update existing tickers and create governed ones.
// GUARDED since the phantom-position incident: the importer used to silently create or
// overwrite ANY OCR-returned row, which let a misread screenshot mint fake positions
// (and even overwrite governed rows with absurd unit counts). Now:
//   — creating a ticker outside the governed universe / known transition set, or
//   — changing an existing holding's units by more than 5×, or
//   — moving the portfolio total by more than 3×
// returns those rows as `needsConfirmation` instead of writing. The owner re-applies
// them explicitly with confirmed: true. SBR keeps its hard whitelist (never bypassed).
const SBR_ALLOWED_TICKERS = new Set(SBR_SPEC.funds.map(f=>f.ticker))
// Constitutionally recognized transition instruments (migration engine's legacy identities).
const ATLAS_KNOWN_LEGACY = ["VT", "QQQM", "VWO", "SMH.US", "GBTC"] as const
const UNIT_DELTA_LIMIT = 5   // flag a >5× (or <1/5×) unit change on an existing holding
const TOTAL_DELTA_LIMIT = 3  // flag an import that moves the portfolio total >3× either way

export interface ExtractedRowInput { ticker: string; units: number; price: number; value?: number }
export interface NeedsConfirmationRow extends ExtractedRowInput { reason: string }

export async function applyExtractedHoldings(
  rows: ExtractedRowInput[],
  opts: { confirmed?: boolean } = {},
): Promise<{ updated: number; created: number; needsConfirmation: NeedsConfirmationRow[] }> {
  const session = await getSession()
  if (!session) throw new Error("Unauthenticated")
  const active = await activePortfolioContext(session)
  assertCanMutateOwner(session, active.owner.id)
  const constitutionId = active.constitutionId
  const ownerId = active.owner.id
  const isSbr = constitutionId === "silicon-brick-road"
  const confirmed = opts.confirmed === true

  const usdSgdRate = await getCachedUsdSgdRate()
  const existing = await db.holding.findMany({
    where: { userId: ownerId },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })
  const byTicker = new Map(existing.map((h) => [h.ticker, h]))
  const atlasAllowedNew = new Set<string>([...GOVERNANCE_UNIVERSE, ...ATLAS_KNOWN_LEGACY])

  const needsConfirmation: NeedsConfirmationRow[] = []
  const candidates: Array<ExtractedRowInput & { sym: string; newValue: number }> = []

  for (const r of rows) {
    const sym = r.ticker?.trim().toUpperCase()
    if (!sym || !(r.units > 0) || !(r.price > 0)) continue
    const extractedSgd = typeof r.value === "number" && Number.isFinite(r.value) && r.value > 0 ? r.value : null
    const newValue = extractedSgd ?? r.units * r.price * usdSgdRate
    const held = byTicker.get(sym)

    if (!held) {
      // SBR whitelist is a hard boundary — never bypassed, even with confirmed: true.
      if (isSbr && !SBR_ALLOWED_TICKERS.has(sym)) continue
      if (!isSbr && !atlasAllowedNew.has(sym) && !confirmed) {
        needsConfirmation.push({ ...r, ticker: sym, reason: `${sym} is not in the plan or its known transition set — creating it needs your confirmation.` })
        continue
      }
    } else if (!confirmed) {
      const oldUnits = held.snapshots[0]?.units ?? 0
      if (oldUnits > 0) {
        const ratio = r.units / oldUnits
        if (ratio > UNIT_DELTA_LIMIT || ratio < 1 / UNIT_DELTA_LIMIT) {
          needsConfirmation.push({ ...r, ticker: sym, reason: `${sym} would change from ${oldUnits.toLocaleString("en-SG")} to ${r.units.toLocaleString("en-SG")} units (×${ratio.toFixed(1)}) — confirm this is really what you hold.` })
          continue
        }
      }
    }
    candidates.push({ ...r, sym, newValue })
  }

  // Portfolio-total guard: an import that swings NAV by >3× either way is almost
  // certainly a misread screenshot — hold everything for confirmation.
  if (!confirmed && candidates.length > 0) {
    const currentTotal = existing.reduce((s, h) => s + (h.snapshots[0]?.value ?? 0), 0)
    const candidateTickers = new Set(candidates.map((c) => c.sym))
    const proposedTotal = candidates.reduce((s, c) => s + c.newValue, 0)
      + existing.filter((h) => !candidateTickers.has(h.ticker)).reduce((s, h) => s + (h.snapshots[0]?.value ?? 0), 0)
    if (currentTotal > 0 && (proposedTotal > currentTotal * TOTAL_DELTA_LIMIT || proposedTotal < currentTotal / TOTAL_DELTA_LIMIT)) {
      for (const c of candidates) needsConfirmation.push({ ticker: c.sym, units: c.units, price: c.price, value: c.value, reason: `Applying this import would move the portfolio total from ${Math.round(currentTotal).toLocaleString("en-SG")} to ${Math.round(proposedTotal).toLocaleString("en-SG")} SGD — confirm before writing.` })
      candidates.length = 0
    }
  }

  let updated = 0
  let created = 0
  for (const c of candidates) {
    let holding = byTicker.get(c.sym)
    if (!holding) {
      // No DB unique constraint exists on (userId, ticker) — re-check immediately before
      // create so a concurrent import/sync can't mint a duplicate Holding row.
      const fresh = await db.holding.findFirst({
        where: { userId: ownerId, ticker: c.sym },
        include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
      })
      if (fresh) { holding = fresh; byTicker.set(c.sym, fresh) }
    }
    if (!holding) {
      const createdRow = await db.holding.create({
        data: { userId: ownerId, ticker: c.sym, name: c.sym, targetPct: 0, hardCapPct: null, toleranceBand: 2.5, color: "#64748b" },
      })
      holding = { ...createdRow, snapshots: [] }
      byTicker.set(c.sym, holding) // a duplicate ticker later in the batch must not create twice
      created++
    }
    // units × price × USDSGD is only correct for USD-quoted lines — DBMFE is EUR-quoted and
    // LSE lines can print in GBp. The vision extractor reads the account-base (SGD) value
    // column directly; prefer it when present and sane (already folded into newValue).
    // Value is authoritative SGD; a misread OCR price (e.g. an SGD-converted column)
    // must not be stored as-is next to it — see lib/unit-price.ts.
    await upsertSnapshotToday(holding.id, { units: c.units, price: valueConsistentPrice(c.units, c.price, c.newValue, usdSgdRate), value: c.newValue })
    updated++
  }

  if (updated > 0 || created > 0) {
    for (const p of ["/portfolio", "/", "/reports", "/forecast", "/governance", "/holdings", "/ytd", "/risk", "/mission-control", "/next"]) revalidatePath(p)
  }
  return { updated, created, needsConfirmation }
}

// ─── Owner data correction (phantom-position recovery) ──────────────────────
// Snapshots carry NO provenance marker, and the one-row-per-day upsert lets a later
// import overwrite an IBKR-sourced row in place — so "reverse everything that didn't
// come from IBKR" cannot be done safely from history. The corrective path is instead
// owner-entered truth: for each holding the owner states the REAL units (and optionally
// the REAL SGD value, e.g. from the TWS screen); a corrective snapshot is written and
// every change is recorded in the governance log. Append-only — nothing is deleted.
export interface PositionCorrection {
  holdingId: string
  units: number          // true units held (0 = position does not exist)
  valueSgd?: number | null // true SGD market value; omitted → units × latest SGD price per unit
}

export async function correctPositions(
  corrections: PositionCorrection[],
): Promise<{ success?: true; applied?: number; error?: string }> {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }
  const active = await activePortfolioContext(session)
  try { assertCanMutateOwner(session, active.owner.id) } catch (error) {
    return { error: error instanceof Error ? error.message : "Read-only access." }
  }
  if (!Array.isArray(corrections) || corrections.length === 0) return { error: "Nothing to correct." }
  if (corrections.length > 100) return { error: "Too many corrections in one batch." }

  const governedSet = new Set(
    (active.constitutionId === "silicon-brick-road" ? SBR_SPEC : ATLAS_SPEC).funds.map((f) => f.ticker),
  )

  let applied = 0
  for (const c of corrections) {
    if (!Number.isFinite(c.units) || c.units < 0) continue
    const holding = await db.holding.findFirst({
      where: { id: c.holdingId, userId: active.owner.id },
      include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
    })
    if (!holding) continue
    const latest = holding.snapshots[0]
    const oldUnits = latest?.units ?? 0
    const oldValue = latest?.value ?? 0
    // SGD per unit from the latest snapshot (value/units — robust across quote currencies).
    const perUnitSgd = latest && latest.units > 0 && latest.value > 0 ? latest.value / latest.units : 0
    const value = typeof c.valueSgd === "number" && Number.isFinite(c.valueSgd) && c.valueSgd >= 0
      ? c.valueSgd
      : c.units * perUnitSgd
    if (Math.abs(c.units - oldUnits) < 1e-9 && Math.abs(value - oldValue) < 0.005) continue

    // Corrective snapshot: stale cost basis / P&L from the erroneous data is cleared —
    // the next IBKR sync restores the authoritative basis.
    await upsertSnapshotToday(holding.id, {
      units: c.units,
      price: c.units > 0 ? (latest?.price ?? 0) : 0,
      value: c.units > 0 ? value : 0,
      costBasis: null,
      unrealizedPnl: null,
    })
    // A zeroed row outside the governed universe closes (drops out of display); governed
    // rows stay ACTIVE as the target architecture even at zero.
    if (c.units === 0 && !governedSet.has(economicSleeveTicker(holding.ticker))) {
      await db.holding.update({ where: { id: holding.id }, data: { instrumentStatus: "CLOSED" } })
    }
    await db.governanceLog.create({
      data: {
        userId: active.owner.id,
        event: "EXCEPTION_LOGGED",
        details: `Data correction: ${holding.ticker} ${oldUnits.toLocaleString("en-SG")} units (S$${Math.round(oldValue).toLocaleString("en-SG")}) → ${c.units.toLocaleString("en-SG")} units (S$${Math.round(c.units > 0 ? value : 0).toLocaleString("en-SG")}). Owner-entered true position; prior data judged erroneous (import provenance is not recorded). History retained.`,
      },
    })
    applied++
  }

  for (const p of ["/portfolio", "/", "/reports", "/forecast", "/governance", "/risk", "/mission-control", "/next", "/contributions"]) revalidatePath(p)
  return { success: true, applied }
}

// ─── Duplicate-holding merge (owner/admin) ───────────────────────────────────
// The DB has no unique constraint on (userId, ticker), and an earlier importer bug
// could create the same ticker twice in one batch. This merges each literal
// same-ticker group: the canonical row (cost basis > freshest snapshot > oldest)
// keeps the group's SUMMED units/value via a corrective snapshot, every other row
// is zeroed and CLOSED (same semantics as removeErroneousPosition), and each group
// gets a governance-log entry. Append-only — no rows or history are deleted.
export async function mergeDuplicateHoldings(): Promise<{ success?: true; merged?: number; closed?: number; error?: string }> {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }
  const active = await activePortfolioContext(session)
  try { assertCanMutateOwner(session, active.owner.id) } catch (error) {
    return { error: error instanceof Error ? error.message : "Read-only access." }
  }

  const holdings = await db.holding.findMany({
    where: { userId: active.owner.id },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })
  const groups = findDuplicateGroups(holdings)
  if (groups.length === 0) return { success: true, merged: 0, closed: 0 }

  const usdSgdRate = await getCachedUsdSgdRate()
  let merged = 0
  let closed = 0
  for (const g of groups) {
    const contributingClosed = g.close.filter((r) => (r.snapshots[0]?.units ?? 0) > 0 || (r.snapshots[0]?.value ?? 0) > 0)
    if (contributingClosed.length > 0) {
      // Fold the duplicates' real position into the kept row so no value is lost.
      // Cost basis is summed only when EVERY contributing row carries one; otherwise it
      // is cleared and the next IBKR sync restores the authoritative figure.
      const contributing = [g.keep, ...contributingClosed]
        .map((r) => r.snapshots[0])
        .filter((snap): snap is NonNullable<typeof snap> => !!snap && (snap.units > 0 || snap.value > 0))
      const costBasis = contributing.length > 0 && contributing.every((snap) => snap.costBasis != null)
        ? contributing.reduce((sum, snap) => sum + (snap.costBasis ?? 0), 0)
        : null
      await upsertSnapshotToday(g.keep.id, {
        units: g.totalUnits,
        price: valueConsistentPrice(g.totalUnits, g.keep.snapshots[0]?.price ?? 0, g.totalValueSgd, usdSgdRate),
        value: g.totalValueSgd,
        costBasis,
        unrealizedPnl: null,
      })
    }
    for (const r of g.close) {
      await upsertSnapshotToday(r.id, { units: 0, price: 0, value: 0, costBasis: 0, unrealizedPnl: 0 })
      await db.holding.update({ where: { id: r.id }, data: { instrumentStatus: "CLOSED" } })
      closed++
    }
    await db.governanceLog.create({
      data: {
        userId: active.owner.id,
        event: "EXCEPTION_LOGGED",
        details: contributingClosed.length > 0
          ? `Duplicate holdings merged: kept ${g.ticker} row …${g.keep.id.slice(-6)} with the group's combined ${g.totalUnits.toLocaleString("en-SG")} units (S$${Math.round(g.totalValueSgd).toLocaleString("en-SG")}); zeroed and closed ${g.close.length} duplicate row(s) [${g.close.map((r) => `…${r.id.slice(-6)}`).join(", ")}]. Append-only; history retained.`
          : `Duplicate holdings merged: kept ${g.ticker} row …${g.keep.id.slice(-6)}; closed ${g.close.length} empty duplicate row(s) [${g.close.map((r) => `…${r.id.slice(-6)}`).join(", ")}] without changing the kept position. Append-only; history retained.`,
      },
    })
    merged++
  }

  for (const p of ["/portfolio", "/", "/reports", "/forecast", "/governance", "/risk", "/mission-control", "/next", "/contributions"]) revalidatePath(p)
  return { success: true, merged, closed }
}

// Owner-only correction for an erroneous NON-GOVERNED row (e.g. a phantom position created
// by a misread screenshot import). Append-only: the holding row and its history stay in the
// DB — a zero snapshot is written (same close semantics as the IBKR sync), the row is marked
// CLOSED, and the correction is recorded in the governance log. Governed sleeve positions
// can never be zeroed from the UI.
export async function removeErroneousPosition(holdingId: string): Promise<{ success?: true; error?: string }> {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }
  const active = await activePortfolioContext(session)
  try { assertCanMutateOwner(session, active.owner.id) } catch (error) {
    return { error: error instanceof Error ? error.message : "Read-only access." }
  }

  const holding = await db.holding.findFirst({ where: { id: holdingId, userId: active.owner.id } })
  if (!holding) return { error: "Holding not found." }
  const governedTickers = active.constitutionId === "silicon-brick-road" ? SBR_SPEC.funds.map((f) => f.ticker) : ATLAS_SPEC.funds.map((f) => f.ticker)
  const governedSet = new Set<string>(governedTickers)
  if (holding.targetPct > 0 || governedSet.has(economicSleeveTicker(holding.ticker))) {
    return { error: "Only non-governed rows can be corrected. Governed positions change through contributions and documented trades." }
  }

  await upsertSnapshotToday(holding.id, { units: 0, price: 0, value: 0, costBasis: 0, unrealizedPnl: 0 })
  await db.holding.update({ where: { id: holding.id }, data: { instrumentStatus: "CLOSED" } })
  await db.governanceLog.create({
    data: {
      userId: active.owner.id,
      event: "EXCEPTION_LOGGED",
      details: `Erroneous ${holding.ticker} position zeroed by owner from the Position Ledger (data correction — row and history retained for audit).`,
    },
  })

  for (const p of ["/portfolio", "/", "/reports", "/forecast", "/governance", "/risk", "/mission-control", "/next"]) revalidatePath(p)
  return { success: true }
}

// Live refresh: update prices AND share counts.
// Share counts (units) can only come from the brokerage, so when IBKR Flex is configured
// we pull live positions (units + mark price + value) — the source of truth. Holdings IBKR
// doesn't report, and the case where IBKR is unconfigured/unavailable, fall back to Yahoo
// Finance price-only with units carried forward.
export async function refreshLivePrices(opts: { withIbkr?: boolean; reconcile?: boolean } = {}): Promise<{
  success: boolean; updated?: number; unitsUpdated?: number; added?: number; removed?: number; source?: "ibkr" | "yahoo"; note?: string; error?: string
}> {
  const withIbkr = opts.withIbkr !== false        // default: use IBKR when configured
  const reconcile = opts.reconcile ?? withIbkr     // add/remove holdings only when we have brokerage truth
  const session = await getSession()
  if (!session) throw new Error("Unauthenticated")
  const active = await activePortfolioContext(session)
  assertCanMutateOwner(session, active.owner.id)
  const constitutionId = active.constitutionId
  const ownerId = active.owner.id
  if (constitutionId === "atlas-core") {
    await ensureCoreHoldings(ownerId)
  } else {
    await ensureSbrPresentation(ownerId)
  }

  const holdings = await db.holding.findMany({
    where: { userId: ownerId },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })

  if (holdings.length === 0) return { success: false, error: "No holdings found" }

  // Yahoo Finance API — map governed tickers to their exchange-qualified symbols.
  const yfSymbols = holdings.map(h => YF_TICKER_MAP[h.ticker] ?? h.ticker)
  const symbols = yfSymbols.join(",")

  const priceMap: Record<string, number> = {}
  let batchSuccess = false

  for (const host of YF_HOSTS) {
    try {
      const res = await fetch(
        `https://${host}/v7/finance/quote?symbols=${symbols}&fields=regularMarketPrice,shortName`,
        { headers: { "User-Agent": "Mozilla/5.0 (compatible; AtlasPortfolio/1.0)" }, cache: "no-store" }
      )
      if (res.ok) {
        const data = await res.json()
        const quotes: Array<{ symbol: string; regularMarketPrice: number }> = data?.quoteResponse?.result ?? []
        for (const q of quotes) {
          // Reverse-map exchange-qualified symbols back to governed database keys.
          const dbTicker = YF_REVERSE_MAP[q.symbol] ?? q.symbol
          if (q.regularMarketPrice) priceMap[dbTicker] = q.regularMarketPrice
        }
        if (Object.keys(priceMap).length > 0) { batchSuccess = true; break }
      }
    } catch {}
  }

  // Per-ticker fallback: try v8/chart on query1 then query2 for any missing tickers
  if (!batchSuccess || Object.keys(priceMap).length < holdings.length) {
    const missing = holdings.filter(h => !priceMap[h.ticker])
    for (const h of missing) {
      const yfTicker = YF_TICKER_MAP[h.ticker] ?? h.ticker
      for (const host of YF_HOSTS) {
        try {
          const r = await fetch(
            `https://${host}/v8/finance/chart/${yfTicker}?interval=1d&range=1d`,
            { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
          )
          if (r.ok) {
            const d = await r.json()
            const price = d?.chart?.result?.[0]?.meta?.regularMarketPrice
            if (price) { priceMap[h.ticker] = price; break }
          }
        } catch {}
      }
    }
  }

  // ── IBKR positions — brokerage truth for SHARE COUNTS (units + mark price + value) ──
  // SBR users get their own Flex tokens (IBKR_SBR_*), falling back to the main tokens
  // if the SBR account isn't wired up yet. Shared with the modal + cron sync paths.
  const { token: ibkrToken, positionsQuery: ibkrQuery } = ibkrCredentialsFor(constitutionId)
  const posMap: Record<string, { units: number; markPrice: number; positionValue: number }> = {}
  let ibkrError: string | null = null
  if (withIbkr && ibkrToken && ibkrQuery) {
    const r = await fetchFlexPositions(ibkrToken, ibkrQuery)
    if (r.success) {
      for (const p of r.positions) {
        posMap[p.symbol.toUpperCase()] = { units: p.units, markPrice: p.markPrice, positionValue: p.positionValue }
      }
    } else {
      ibkrError = r.error
    }
  }
  const haveIbkr = Object.keys(posMap).length > 0

  // London UCITS lines can be quoted in USD, GBP or GBp. Until quote metadata is
  // resolved by ISIN/venue/currency, SBR valuation refreshes must use IBKR's base-currency
  // position value and must never infer SGD value from an unlabelled Yahoo number.
  if (constitutionId === "silicon-brick-road" && !haveIbkr) {
    return { success: false, error: ibkrError ? `SBR requires an authoritative IBKR positions report: ${ibkrError}` : "SBR requires an authoritative IBKR positions report; public quote fallback is disabled." }
  }

  if (Object.keys(priceMap).length === 0 && !haveIbkr) {
    return {
      success: false,
      error: ibkrError
        ? `Price API unavailable and IBKR sync failed: ${ibkrError}`
        : "Price API unavailable — both Yahoo Finance endpoints failed",
    }
  }

  const usdSgdRate = await getCachedUsdSgdRate()

  let updated = 0
  let unitsUpdated = 0
  for (const holding of holdings) {
    const latest = holding.snapshots[0]
    const pos = posMap[holding.ticker.toUpperCase()]
    const yh = priceMap[holding.ticker]

    let units: number
    let price: number
    let value: number

    if (pos) {
      // Brokerage truth — update units AND price together.
      units = pos.units
      value = pos.positionValue > 0 ? pos.positionValue : pos.units * pos.markPrice * usdSgdRate
      // IBKR's positionValue (SGD base) is authoritative; keep the stored price consistent
      // with it (a stray mark in the wrong currency would otherwise contradict the value).
      price = valueConsistentPrice(units, pos.markPrice, value, usdSgdRate)
      if (!latest || Math.abs((latest.units ?? 0) - units) > 1e-6) unitsUpdated++
    } else if (yh && latest) {
      // Yahoo price-only — carry units forward (no brokerage data for this holding).
      // Any explicitly SGD-priced ticker must not be multiplied by the USD→SGD rate.
      const yfSym = YF_TICKER_MAP[holding.ticker]
      const isSgdPriced = yfSym ? YF_SGD_PRICED.has(yfSym) : false
      units = latest.units
      price = yh
      value = latest.units * yh * (isSgdPriced ? 1 : usdSgdRate)
    } else {
      continue
    }

    await upsertSnapshotToday(holding.id, { units, price, value })
    updated++
  }

  // ── Reconcile holdings against the brokerage (only with a valid IBKR positions list) ──
  // fetchFlexPositions only succeeds with a non-empty list, so this never wipes everything
  // on a failed/empty report. Removal is SOFT (a 0-unit snapshot) — reversible, and it
  // preserves value history; the holding drops out of allocations.
  let added = 0
  let removed = 0
  if (reconcile && haveIbkr) {
    const dbTickers = new Set(holdings.map(h => h.ticker.toUpperCase()))

    // Add: positions IBKR reports that we don't track yet (created untracked, target 0%).
    for (const [sym, p] of Object.entries(posMap)) {
      if (dbTickers.has(sym)) continue
      // No unique constraint on (userId, ticker) — find-first immediately before create
      // so a concurrent sync/import can't mint a duplicate Holding row.
      const preexisting = await db.holding.findFirst({ where: { userId: ownerId, ticker: sym } })
      const created = preexisting ?? await db.holding.create({
        data: {
          userId: ownerId, ticker: sym, name: sym,
          targetPct: 0, hardCapPct: null, toleranceBand: 2.5, color: "#64748b",
        },
      })
      await upsertSnapshotToday(created.id, {
        units: p.units, price: p.markPrice,
        value: p.positionValue > 0 ? p.positionValue : p.units * p.markPrice * usdSgdRate,
      })
      added++
    }

    // Remove (soft): tracked holdings the brokerage no longer reports → zero them out.
    for (const holding of holdings) {
      if (posMap[holding.ticker.toUpperCase()]) continue
      const latest = holding.snapshots[0]
      if (!latest || latest.units === 0) continue // already closed / placeholder (e.g. SGOV, IBIT)
      await upsertSnapshotToday(holding.id, { units: 0, price: latest.price, value: 0 })
      removed++
    }
  }

  revalidatePath("/portfolio")
  revalidatePath("/")
  revalidatePath("/reports")
  revalidatePath("/forecast")
  revalidatePath("/governance")
  revalidatePath("/risk")
  revalidatePath("/mission-control")

  const note = ibkrToken && ibkrQuery && !haveIbkr
    ? `IBKR sync unavailable (${ibkrError ?? "no positions returned"}) — prices updated from Yahoo; share counts unchanged.`
    : (!ibkrToken || !ibkrQuery)
    ? "Prices updated from Yahoo. Connect IBKR (IBKR_FLEX_TOKEN/QUERY_ID) to also sync share counts."
    : undefined

  return { success: true, updated, unitsUpdated, added, removed, source: haveIbkr ? "ibkr" : "yahoo", note }
}

type ExtractResult =
  | { success: true; data: Array<{ ticker: string; units: number; price: number; value: number }> }
  | { success: false; error: string }

// Holdings import: extract holdings data from an IBKR screenshot (Claude vision) or a
// PDF statement (Claude document reading) — same prompt, same downstream guards.
// The payload must be a single object, not positional string args: React's server-action
// decoder budgets string length against a 1M-slot array limit when strings sit directly in
// the (multi-element) argument array, so a base64 PDF as a bare argument throws
// "Maximum array nesting exceeded". Object properties are exempt from that counter.
export async function extractFromScreenshot(payload: {
  imageBase64: string
  mimeType: string
}): Promise<ExtractResult> {
  try {
    const { imageBase64, mimeType } = payload
    const session = await getSession()
    if (!session) return { success: false, error: "Not authenticated" }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return { success: false, error: "ANTHROPIC_API_KEY is not configured on this server" }

    const client = new Anthropic({ apiKey })

    const mediaBlock =
      mimeType === "application/pdf"
        ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: imageBase64 } } as const)
        : ({
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: imageBase64,
            },
          } as const)

    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            mediaBlock,
            {
              type: "text",
              text: `This is a brokerage (IBKR) portfolio screenshot or account-statement PDF. Extract the holdings data (for a PDF, use the open/current positions section — ignore trade history and closed positions).

For each holding visible, return a JSON array with objects containing:
- ticker: the stock/ETF ticker symbol (string)
- units: number of shares/units held (number)
- price: current price per unit in the fund's own TRADING currency (USD/EUR/GBp), never a converted figure (number)
- value: total market value in SGD — the account BASE-currency column. This is the authoritative field; read it directly from the screenshot, do not compute it (number)

If the screenshot only shows SGD-converted per-unit prices (no trading-currency column), still return the SGD market value in "value" and put the SGD per-unit figure in "price" — the app reconciles price against value and treats value as truth.
Only include ETF/stock holdings, not cash. Return ONLY a valid JSON array, no explanation.
Example: [{"ticker":"VWRA","units":428,"price":142.52,"value":61038.56}]`,
            },
          ],
        },
      ],
    })

    const text = message.content[0].type === "text" ? message.content[0].text : ""
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return { success: false, error: "Claude could not find holdings data in the screenshot" }

    const data = JSON.parse(jsonMatch[0])
    return { success: true, data }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    return { success: false, error: msg }
  }
}
