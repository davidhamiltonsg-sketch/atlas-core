/**
 * Ingestion dedup/reconcile contract check.
 *
 * The IBKR import must be idempotent and self-healing without ever discarding real trades:
 *   • selectExecutionsToImport — a re-import (even under NEW tradeIDs) adds nothing, while genuine
 *     same-price partial fills of one order both import.
 *   • selectStaleDuplicateTrades — an already-doubled log is trimmed back to the report's truth,
 *     preferring report-confirmed rows, and never touches keys outside the report's window.
 * Pure functions — no DB, no network.
 *
 * Run:  npx tsx scripts/check-ingest.ts   (or: npm run check:ingest)
 */
import {
  selectExecutionsToImport, selectStaleDuplicateTrades, executionNaturalKey, naturalKey,
} from "../lib/ingest-dedup"
import type { FlexExecution } from "../lib/ibkr-flex"

let failures = 0, passes = 0
function eq(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`  ✗  ${label}\n       expected: ${JSON.stringify(expected)}\n       got:      ${JSON.stringify(actual)}`)
    failures++
  } else { passes++ }
}

function ex(tradeID: string, symbol: string, buySell: "BUY" | "SELL", quantity: number, price: number, tradeDate: string): FlexExecution {
  return { tradeID, symbol, buySell, quantity, price, currency: "USD", fxRate: 1.35, tradeDate }
}
const counts = (rows: { ticker: string; type: string; units: number; price: number; date: Date }[]) => {
  const m = new Map<string, number>()
  for (const r of rows) { const k = naturalKey(r.ticker, r.type, r.units, r.price, r.date); m.set(k, (m.get(k) ?? 0) + 1) }
  return m
}

console.log("Ingestion dedup/reconcile — contract check\n")

// ── selectExecutionsToImport ──────────────────────────────────────────────────
const batch = [ex("A1", "VT", "BUY", 10, 100, "20260615"), ex("A2", "QQQM", "BUY", 5, 200, "20260615")]

// 1. Fresh DB → import everything.
eq("fresh import → all", selectExecutionsToImport(batch, new Set(), new Map()).map((e) => e.tradeID), ["A1", "A2"])

// 2. Same ids already stored → import nothing.
eq("re-run same ids → none", selectExecutionsToImport(batch, new Set(["A1", "A2"]), new Map()).length, 0)

// 3. Re-import under NEW ids (same trades already in DB by natural key) → import nothing.
const dbCounts = counts([
  { ticker: "VT", type: "BUY", units: 10, price: 100, date: new Date("2026-06-15") },
  { ticker: "QQQM", type: "BUY", units: 5, price: 200, date: new Date("2026-06-15") },
])
const reimport = [ex("B1", "VT", "BUY", 10, 100, "20260615"), ex("B2", "QQQM", "BUY", 5, 200, "20260615")]
eq("re-import new ids → none (no doubling)", selectExecutionsToImport(reimport, new Set(["A1", "A2"]), dbCounts).length, 0)

// 4. Genuine partial fills (two same-price executions of one order) → both import.
const fills = [ex("C1", "SMH", "BUY", 50, 150, "20260615"), ex("C2", "SMH", "BUY", 50, 150, "20260615")]
eq("partial fills → both import", selectExecutionsToImport(fills, new Set(), new Map()).map((e) => e.tradeID), ["C1", "C2"])

// ── selectStaleDuplicateTrades ────────────────────────────────────────────────
const D15 = new Date("2026-06-15"), D16 = new Date("2026-06-16")
const kVT = naturalKey("VT", "BUY", 10, 100, D15)
const kSMH = naturalKey("SMH", "BUY", 50, 150, D15)

// 5. Doubled key, one copy confirmed by the report → delete the stale copy, keep the confirmed one.
eq("doubled + report overlap → drop stale",
  selectStaleDuplicateTrades(
    new Map([[kVT, [{ id: "old", ibkrId: "OLD1", date: D15 }, { id: "new", ibkrId: "NEW1", date: D16 }]]]),
    new Map([[kVT, 1]]), new Set(["NEW1"])),
  ["old"])

// 6. Manual duplicate of an imported trade → delete the manual (null id) copy.
eq("manual dup + import → drop manual",
  selectStaleDuplicateTrades(
    new Map([[kVT, [{ id: "manual", ibkrId: null, date: D15 }, { id: "imp", ibkrId: "NEW1", date: D16 }]]]),
    new Map([[kVT, 1]]), new Set(["NEW1"])),
  ["manual"])

// 7. Doubled with NO id overlap → trim to the report count, keeping the OLDEST.
eq("doubled, no overlap → trim to count keep oldest",
  selectStaleDuplicateTrades(
    new Map([[kVT, [{ id: "younger", ibkrId: "X", date: D16 }, { id: "older", ibkrId: "Y", date: D15 }]]]),
    new Map([[kVT, 1]]), new Set(["Z"])),
  ["younger"])

// 8. Genuine partial fills, both in the report → remove nothing.
eq("partial fills in report → keep both",
  selectStaleDuplicateTrades(
    new Map([[kSMH, [{ id: "f1", ibkrId: "C1", date: D15 }, { id: "f2", ibkrId: "C2", date: D15 }]]]),
    new Map([[kSMH, 2]]), new Set(["C1", "C2"])),
  [])

// 9. A key OUTSIDE the report window (not in batch counts) is never touched.
eq("outside report window → untouched",
  selectStaleDuplicateTrades(
    new Map([[kVT, [{ id: "a", ibkrId: "P", date: D15 }, { id: "b", ibkrId: "Q", date: D16 }]]]),
    new Map([[kSMH, 1]]), new Set(["R"])),
  [])

// 10. natural key of an execution matches the DB-row key helper (same fields → same string).
eq("execution/row natural keys agree",
  executionNaturalKey(ex("Z9", "VT", "BUY", 10, 100, "20260615")),
  naturalKey("VT", "BUY", 10, 100, D15))

console.log(`\n${"─".repeat(54)}`)
if (failures === 0) { console.log(`  All ${passes} checks passed. Ingestion is idempotent, self-healing, and partial-fill-safe ✓`); process.exit(0) }
else { console.error(`  ${failures} check(s) failed, ${passes} passed.`); process.exit(1) }
