/**
 * Atlas Core — Next-Best-Move engine scenario checks.
 *
 * Asserts the precedence ladder produces the right action for representative portfolio
 * states. Pure function calls — no DB, no network. Complements scripts/check-governance.ts.
 *
 * Run:  npx tsx scripts/check-engine.ts   (or: npm run check:engine)
 */
import { computeNextBestMove, type PositionInput, type EngineMarket } from "../lib/next-best-move"

let failures = 0
function expect(label: string, cond: boolean, detail?: string) {
  if (!cond) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failures++ }
  else console.log(`  ✓ ${label}`)
}

const COLOR = "#000"
function pos(ticker: string, actualPct: number, targetPct: number, hardCapPct: number | null): PositionInput {
  return { ticker, name: ticker, color: COLOR, value: actualPct, actualPct, targetPct, hardCapPct, toleranceBand: 2.5, latestPrice: 100 }
}

// Market overlay helpers: a position is "overbought" within 3% of its 52-week high,
// a "dip" at ≥12% below. mid() sits at −8% (neither).
const mid = { price: 92, lo52: 60, hi52: 100, histVolPct: 15 }
const high = { price: 99, lo52: 60, hi52: 100, histVolPct: 15 }
function marketAll(over: Record<string, typeof mid> = {}): EngineMarket {
  const base: EngineMarket = {}
  for (const t of ["VT", "QQQM", "SMH", "VWO"]) base[t] = { ...mid }
  return { ...base, ...over }
}

console.log("Atlas Core — engine scenario checks\n")

// 1) Healthy, buffer built, nothing overbought → STANDARD DCA (severity none).
{
  const positions = [
    pos("VT", 48, 48, 60), pos("QQQM", 21, 21, 30), pos("SMH", 9, 9, 12),
    pos("VWO", 7, 7, 13), pos("BTC", 7, 7, 8), pos("SGOV", 8, 8, null),
  ]
  const m = computeNextBestMove(positions, 1000, { market: marketAll() })
  expect("healthy → standard DCA (none)", m.severity === "none" && /standard DCA/i.test(m.action), `got ${m.severity} / "${m.action}"`)
}

// 2) SMH over its 12% hard cap → CRITICAL trim SMH.
{
  const positions = [
    pos("VT", 45, 48, 60), pos("QQQM", 22, 21, 30), pos("SMH", 13, 9, 12),
    pos("VWO", 5, 7, 13), pos("BTC", 7, 7, 8), pos("SGOV", 8, 8, null),
  ]
  const m = computeNextBestMove(positions, 1000, { market: marketAll() })
  expect("SMH > 12% cap → critical trim SMH", m.severity === "critical" && m.ticker === "SMH" && /trim/i.test(m.action), `got ${m.severity} / ${m.ticker} / "${m.action}"`)
}

// 3) Buffer below the 8% floor (no SGOV) → HIGH build buffer.
{
  const positions = [
    pos("VT", 52, 52, 60), pos("QQQM", 23, 23, 30), pos("SMH", 10, 10, 12),
    pos("VWO", 8, 8, 13), pos("BTC", 7, 7, 8),
  ]
  const m = computeNextBestMove(positions, 1000, { market: marketAll() })
  expect("buffer < 8% → high build SGOV", m.severity === "high" && m.ticker === "SGOV" && /buffer/i.test(m.action), `got ${m.severity} / ${m.ticker} / "${m.action}"`)
}

// 4) Conviction holding (QQQM) underweight, buffer OK, not overbought → MEDIUM accumulate.
{
  const positions = [
    pos("VT", 52, 50, 60), pos("QQQM", 16, 23, 30), pos("SMH", 9, 9, 12),
    pos("VWO", 8, 8, 13), pos("BTC", 7, 7, 8), pos("SGOV", 8, 8, null),
  ]
  const m = computeNextBestMove(positions, 1000, { market: marketAll() })
  expect("QQQM underweight → medium accumulate QQQM", m.severity === "medium" && m.ticker === "QQQM" && /accumulate|fill/i.test(m.action), `got ${m.severity} / ${m.ticker} / "${m.action}"`)
}

// 5) Combined QQQM+SMH over the 42% hard ceiling → CRITICAL trim SMH first.
{
  const positions = [
    pos("VT", 38, 48, 60), pos("QQQM", 30, 23, 30), pos("SMH", 13, 9, 12),
    pos("VWO", 4, 7, 13), pos("BTC", 7, 7, 8), pos("SGOV", 8, 8, null),
  ]
  const m = computeNextBestMove(positions, 1000, { market: marketAll() })
  expect("QQQM+SMH > 42% → critical trim SMH", m.severity === "critical" && m.ticker === "SMH", `got ${m.severity} / ${m.ticker} / "${m.action}"`)
}

// 6) Everything healthy but SMH at its 52-week high → LOW "skip the highs".
{
  const positions = [
    pos("VT", 48, 48, 60), pos("QQQM", 21, 21, 30), pos("SMH", 9, 9, 12),
    pos("VWO", 7, 7, 13), pos("BTC", 7, 7, 8), pos("SGOV", 8, 8, null),
  ]
  const m = computeNextBestMove(positions, 1000, { market: marketAll({ SMH: { ...high } }) })
  expect("SMH overbought → low skip-the-highs", m.severity === "low" && /skip|high/i.test(m.action), `got ${m.severity} / "${m.action}"`)
}

// 7) Empty portfolio (no balance) → never throws, returns an action.
{
  const m = computeNextBestMove([], 0, {})
  expect("empty portfolio → returns a safe action", typeof m.action === "string" && m.action.length > 0, `got "${m.action}"`)
}

if (failures === 0) { console.log("\n  ✓ All engine scenarios behaved as specified.\n"); process.exit(0) }
else { console.error(`\n${failures} engine scenario(s) failed.\n`); process.exit(1) }
