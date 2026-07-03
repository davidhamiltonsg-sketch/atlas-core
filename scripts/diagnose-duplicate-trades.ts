/**
 * Diagnose (and optionally repair) duplicated trades that double the portfolio value.
 *
 * Symptom this targets: the Atlas Core total reads ~2× reality because the trade log contains
 * the SAME executions twice — e.g. IBKR re-issued them under new tradeIDs, so the id-only dedup
 * imported every buy again. `syncHoldingFromTrades` then computes netUnits = Σ buys − Σ sells
 * over the doubled log, so each holding's snapshot value doubles. With the position sync failing
 * on the transient IBKR 1001, IBKR's true positionValue never overwrites it.
 *
 * READ-ONLY by default: prints, per Atlas Core user, each holding's latest snapshot units/value,
 * the netUnits implied by the trade log, and every group of duplicate trades (same ticker + side
 * + units + price + day). Pass --apply to delete the duplicates (keeping one per group, preferring
 * an [ibkr:]-noted row), remove their linked contributions, and re-sync the affected holdings.
 *
 *   Read-only:  npx tsx scripts/diagnose-duplicate-trades.ts
 *   Repair:     npx tsx scripts/diagnose-duplicate-trades.ts --apply
 *
 * Requires DATABASE_URL (and DATABASE_AUTH_TOKEN for Turso) in the environment.
 */
import { db } from "../lib/db"
import { constitutionIdForEmail } from "../lib/constitutions"
import { syncHoldingFromTrades } from "../lib/holdings-sync"

const APPLY = process.argv.includes("--apply")

function dayKey(d: Date): string {
  return new Date(d).toISOString().slice(0, 10)
}
function tradeKey(t: { ticker: string; type: string; units: number; price: number; date: Date }): string {
  return `${t.ticker.toUpperCase()}|${t.type}|${t.units}|${t.price}|${dayKey(t.date)}`
}
function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 })
}

async function main() {
  console.log(`\nDuplicate-trade diagnosis  (${APPLY ? "APPLY — will delete duplicates" : "read-only — no changes"})\n`)

  const users = await db.user.findMany({ select: { id: true, email: true, name: true } })
  const atlas = users.filter((u) => constitutionIdForEmail(u.email) === "atlas-core")
  if (atlas.length === 0) { console.log("No Atlas Core users found."); return }

  let totalDupsFound = 0
  let totalDupsRemoved = 0

  for (const u of atlas) {
    console.log(`── ${u.name || u.email} (${u.email}) ${"─".repeat(Math.max(0, 40 - (u.name || u.email).length))}`)

    const holdings = await db.holding.findMany({
      where: { userId: u.id },
      include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
    })
    const trades = await db.trade.findMany({ where: { userId: u.id }, orderBy: { date: "asc" } })

    // Group trades by natural key; any group with >1 row is a duplicate set.
    const groups = new Map<string, typeof trades>()
    for (const t of trades) {
      const k = tradeKey(t)
      const arr = groups.get(k) ?? []
      arr.push(t)
      groups.set(k, arr)
    }

    const dupGroups = [...groups.entries()].filter(([, arr]) => arr.length > 1)
    const totalValue = holdings.reduce((s, h) => s + (h.snapshots[0]?.value ?? 0), 0)
    console.log(`   holdings: ${holdings.length}   trades: ${trades.length}   latest total value: ${fmt(totalValue)}`)

    // Per-holding: snapshot units vs netUnits implied by the (current) trade log. A 2× gap is the
    // tell-tale of duplicated trades driving a trade-derived snapshot.
    for (const h of holdings) {
      const sym = h.ticker.toUpperCase()
      const net = trades.filter((t) => t.ticker.toUpperCase() === sym)
        .reduce((s, t) => s + (t.type === "BUY" ? t.units : -t.units), 0)
      const snapUnits = h.snapshots[0]?.units ?? 0
      const flag = snapUnits > 0 && Math.abs(net - snapUnits) > 1e-6 ? "  ⚠ units mismatch" : ""
      if (net !== 0 || snapUnits !== 0) {
        console.log(`     ${sym.padEnd(6)} snapshot ${fmt(snapUnits).padStart(12)} u   trade-log net ${fmt(net).padStart(12)} u${flag}`)
      }
    }

    if (dupGroups.length === 0) {
      console.log("   ✓ no duplicate trades\n")
      continue
    }

    console.log(`   ⚠ ${dupGroups.length} duplicate trade group(s):`)
    for (const [k, arr] of dupGroups) {
      totalDupsFound += arr.length - 1
      // Keep one: prefer an [ibkr:]-noted (authoritative) row, else the earliest id.
      const sorted = [...arr].sort((a, b) => {
        const ai = a.note?.includes("[ibkr:") ? 0 : 1
        const bi = b.note?.includes("[ibkr:") ? 0 : 1
        return ai - bi || a.id.localeCompare(b.id)
      })
      const keep = sorted[0]
      const drop = sorted.slice(1)
      console.log(`     ${k}  ×${arr.length}  keep ${keep.id.slice(0, 8)} · drop ${drop.map((d) => d.id.slice(0, 8)).join(", ")}`)

      if (APPLY) {
        for (const d of drop) {
          await db.contributionRecord.deleteMany({ where: { userId: u.id, note: { contains: `[trade:${d.id}]` } } })
          await db.trade.delete({ where: { id: d.id } })
          totalDupsRemoved++
        }
      }
    }

    if (APPLY) {
      const affected = new Set(dupGroups.map(([k]) => k.split("|")[0]))
      for (const sym of affected) await syncHoldingFromTrades(u.id, sym)
      console.log(`   ✓ removed duplicates and re-synced ${affected.size} holding(s)\n`)
    } else {
      console.log("   (run again with --apply to remove the dropped rows and re-sync)\n")
    }
  }

  console.log("─".repeat(56))
  if (APPLY) console.log(`  Done. Removed ${totalDupsRemoved} duplicate trade(s).`)
  else console.log(`  Found ${totalDupsFound} duplicate trade(s) to remove. Re-run with --apply to fix.`)
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
