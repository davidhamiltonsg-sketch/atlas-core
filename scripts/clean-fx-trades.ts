/**
 * Atlas Core — remove forex / cash-conversion rows wrongly imported from IBKR.
 *
 * IBKR Flex activity includes currency conversions (USD.SGD, SGD.HKD, USD.HKD, …). These
 * were previously imported as equity trades AND auto-linked as "contributions", which
 * inflated the trade log, the contribution totals (988% of target), and polluted the risk
 * timeline with ghost currency "holdings". lib/ibkr-flex.ts now filters them at import;
 * this script removes the rows that already landed in the database.
 *
 * Deletes, for every user:
 *   • Trades whose ticker is a forex pair (or was tagged CASH)
 *   • ContributionRecords auto-created from those trades (note references the trade id)
 *     or that describe a forex BUY directly
 *   • Dividends with a forex ticker (defensive; normally none)
 *   • Holdings whose ticker is a forex pair (snapshots cascade)
 *
 * Run:  npx tsx scripts/clean-fx-trades.ts            (dry run — reports only)
 *       npx tsx scripts/clean-fx-trades.ts --apply    (actually delete)
 */

import { db } from "../lib/db"
import { isForexRow } from "../lib/ibkr-flex"

const APPLY = process.argv.includes("--apply")

function log(...args: unknown[]) {
  console.log(...args)
}

async function main() {
  log(`Atlas Core — FX-conversion cleanup (${APPLY ? "APPLY" : "DRY RUN"})\n`)

  // ── Trades ──────────────────────────────────────────────────────────────────
  const trades = await db.trade.findMany({ select: { id: true, ticker: true, note: true } })
  const fxTrades = trades.filter((t) => isForexRow(t.ticker))
  const fxTradeIds = new Set(fxTrades.map((t) => t.id))
  log(`Trades:        ${fxTrades.length} forex row(s) of ${trades.length} total`)
  for (const t of fxTrades) log(`  - ${t.ticker}  (${t.id})`)

  // ── Contributions auto-linked to those trades, or describing a forex BUY ──────
  const contributions = await db.contributionRecord.findMany({ select: { id: true, note: true, amount: true } })
  const fxContribs = contributions.filter((c) => {
    const note = c.note ?? ""
    const linkedTradeId = note.match(/\[trade:([^\]]+)\]/)?.[1]
    if (linkedTradeId && fxTradeIds.has(linkedTradeId)) return true
    // Fallback: note text like "BUY 114.85 USD.HKD @ $7.83"
    const sym = note.match(/BUY\s+[\d.]+\s+([A-Z]{3}\.[A-Z]{3})\b/)?.[1]
    return sym ? isForexRow(sym) : false
  })
  log(`\nContributions: ${fxContribs.length} forex-linked row(s) of ${contributions.length} total`)

  // ── Dividends (defensive) ─────────────────────────────────────────────────────
  const dividends = await db.dividend.findMany({ select: { id: true, ticker: true } })
  const fxDivs = dividends.filter((d) => isForexRow(d.ticker))
  log(`Dividends:     ${fxDivs.length} forex row(s) of ${dividends.length} total`)

  // ── Ghost forex holdings (snapshots cascade on delete) ────────────────────────
  const holdings = await db.holding.findMany({ select: { id: true, ticker: true } })
  const fxHoldings = holdings.filter((h) => isForexRow(h.ticker))
  log(`Holdings:      ${fxHoldings.length} forex ghost holding(s) of ${holdings.length} total`)
  for (const h of fxHoldings) log(`  - ${h.ticker}  (${h.id})`)

  if (!APPLY) {
    log(`\nDry run only. Re-run with --apply to delete the rows above.`)
    return
  }

  const delContribs = fxContribs.length ? await db.contributionRecord.deleteMany({ where: { id: { in: fxContribs.map((c) => c.id) } } }) : { count: 0 }
  const delDivs     = fxDivs.length     ? await db.dividend.deleteMany({ where: { id: { in: fxDivs.map((d) => d.id) } } }) : { count: 0 }
  const delTrades   = fxTrades.length   ? await db.trade.deleteMany({ where: { id: { in: fxTrades.map((t) => t.id) } } }) : { count: 0 }
  const delHoldings = fxHoldings.length ? await db.holding.deleteMany({ where: { id: { in: fxHoldings.map((h) => h.id) } } }) : { count: 0 }

  log(`\nDeleted: ${delTrades.count} trades · ${delContribs.count} contributions · ${delDivs.count} dividends · ${delHoldings.count} holdings (snapshots cascaded).`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1) })
