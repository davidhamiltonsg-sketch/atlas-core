/**
 * Atlas Core — Next-Best-Move engine scenario checks.
 *
 * Asserts the precedence ladder produces the right action for representative portfolio
 * states. Pure function calls — no DB, no network. Complements scripts/check-governance.ts.
 *
 * Run:  npx tsx scripts/check-engine.ts   (or: npm run check:engine)
 */
import { computeNextBestMove, type PositionInput, type EngineMarket } from "../lib/next-best-move"
import { computeLadder, type LiveMarketPos } from "../lib/ladder"

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

// 8) VT over its 60% hard cap → CRITICAL trim VT (Art. VII).
{
  const positions = [
    pos("VT", 62, 52, 60), pos("QQQM", 23, 23, 30), pos("SMH", 10, 10, 12),
    pos("VWO", 8, 8, 13), pos("BTC", 7, 7, 8), pos("SGOV", 8, 8, null),
  ]
  const m = computeNextBestMove(positions, 1000, { market: marketAll() })
  expect("VT > 60% cap → critical trim VT", m.severity === "critical" && m.ticker === "VT" && /trim/i.test(m.action), `got ${m.severity} / ${m.ticker} / "${m.action}"`)
}

// 9) VWO over its 13% hard cap → CRITICAL trim VWO (Art. VII).
{
  const positions = [
    pos("VT", 52, 52, 60), pos("QQQM", 23, 23, 30), pos("SMH", 10, 10, 12),
    pos("VWO", 14, 8, 13), pos("BTC", 7, 7, 8), pos("SGOV", 8, 8, null),
  ]
  const m = computeNextBestMove(positions, 1000, { market: marketAll() })
  expect("VWO > 13% cap → critical trim VWO", m.severity === "critical" && m.ticker === "VWO" && /trim/i.test(m.action), `got ${m.severity} / ${m.ticker} / "${m.action}"`)
}

// 10) Cross-engine agreement: the ladder (dashboard) and next-best-move (calendar) must
//     trim the SAME ticker on a hard-cap breach — this is the invariant that was broken
//     when only next-best-move enforced the VT/VWO caps.
{
  const ladderMarket: Record<string, LiveMarketPos> = {}
  for (const [ticker, over] of [["VT", 62], ["VWO", 14]] as const) {
    const positions = [
      pos("VT",   ticker === "VT"  ? over : 52, 52, 60),
      pos("QQQM", 23, 23, 30), pos("SMH", 10, 10, 12),
      pos("VWO",  ticker === "VWO" ? over : 8,  8, 13),
      pos("BTC",  7, 7, 8), pos("SGOV", 8, 8, null),
    ]
    const nbm = computeNextBestMove(positions, 1000, { market: marketAll() })
    const lad = computeLadder(positions, 1000, { market: ladderMarket })
    expect(`both engines trim ${ticker} on breach`, nbm.ticker === ticker && lad.ticker === ticker, `nbm=${nbm.ticker} ladder=${lad.ticker}`)
  }
}

// 11) Cross-engine agreement at a deep crash: with the buffer built, a ≤−25% drawdown must
//     make BOTH engines say "keep buying" (A2), never contradictory advice.
{
  const positions = [
    pos("VT", 52, 52, 60), pos("QQQM", 23, 23, 30), pos("SMH", 10, 10, 12),
    pos("VWO", 8, 8, 13), pos("BTC", 7, 7, 8), pos("SGOV", 8, 8, null),
  ]
  const nbm = computeNextBestMove(positions, 1000, { market: marketAll(), portfolioDrawdownPct: -30 })
  const lad = computeLadder(positions, 1000, { market: {}, portfolioDrawdownPct: -30 })
  expect("crash: both engines say keep buying",
    /keep buying|crash protocol/i.test(nbm.action) && /keep buying|crash protocol/i.test(lad.headline),
    `nbm="${nbm.action}" ladder="${lad.headline}"`)
}

if (failures === 0) { console.log("\n  ✓ All engine scenarios behaved as specified.\n"); process.exit(0) }
else { console.error(`\n${failures} engine scenario(s) failed.\n`); process.exit(1) }
