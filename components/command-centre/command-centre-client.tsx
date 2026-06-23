"use client"

import { useState } from "react"
import {
  Zap, Shield, Search, Calendar, AlertTriangle, CheckCircle2,
  TrendingDown, TrendingUp, Clock, ChevronDown, ChevronUp,
  Target, Flame, ArrowRight, Info, XCircle, ShieldAlert
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { NextMove } from "@/lib/next-best-move"

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface Position {
  ticker: string
  name: string
  color: string
  targetPct: number
  hardCapPct: number | null
  toleranceBand?: number
  latestValue: number
  latestUnits: number
  latestPrice: number
}

interface Props {
  positions: Position[]
  totalValue: number
  nextBestMove: NextMove
}

// ─── LIVE MARKET DATA (Jun 23 2026 IBKR snapshot) ─────────────────────────────
// These supplement the DB values with real-time vol + 52-week context
const MARKET_DATA: Record<string, {
  ytdPct: number
  histVolPct: number
  lo52: number
  hi52: number
  avgCost: number
  signal: "BUY" | "HOLD" | "WATCH" | "EXIT" | "DECIDE"
  signalColor: string
  entryZone: string
  entryTrigger: string
  scanNote: string
  confidence: number
}> = {
  SMH: {
    ytdPct: 84.52,
    histVolPct: 52.8,
    lo52: 257.12,
    hi52: 663.80,
    avgCost: 292.09,
    signal: "HOLD",
    signalColor: "amber",
    entryZone: "$550 – $590",
    entryTrigger: "Price drops below $590 AND holds for 3 consecutive days",
    scanNote: "At 52-week high. Bollinger Band breach Jun 2. MACD sell signal Jun 9. Vol at 53% (elevated). Pattern: every prior breach at these signals preceded a 12–20% pullback. Do NOT add here — wait for the dip.",
    confidence: 78,
  },
  QQQM: {
    ytdPct: 20.13,
    histVolPct: 23.7,
    lo52: 214.72,
    hi52: 308.21,
    avgCost: 259.27,
    signal: "HOLD",
    signalColor: "amber",
    entryZone: "$270 – $285",
    entryTrigger: "Fed rate cut confirmed OR price drops to $280 (non-macro context)",
    scanNote: "20% YTD but less stretched than SMH. Historical vol 24% (normal). Headwinds: Fed hold + Iran war inflation risk. Watch $285 — if it drops there, accumulate in tranches.",
    confidence: 65,
  },
  VT: {
    ytdPct: 11.94,
    histVolPct: 15.5,
    lo52: 121.51,
    hi52: 159.41,
    avgCost: 135.30,
    signal: "BUY",
    signalColor: "green",
    entryZone: "$148 – $158 (current range)",
    entryTrigger: "Any week VT drops to $148 or below → buy 10–15 shares",
    scanNote: "Lowest volatility in the portfolio (15.5%). Steady uptrend. Near 52-week high but not at extremes. Safe to accumulate at current levels. Core retirement position — this is what you're building toward 2045.",
    confidence: 72,
  },
  VWO: {
    ytdPct: 13.84,
    histVolPct: 20.6,
    lo52: 46.31,
    hi52: 61.35,
    avgCost: 58.89,
    signal: "DECIDE",
    signalColor: "orange",
    entryZone: "$56 – $59 if adding",
    entryTrigger: "Go to 200 shares: wait for $58–59 dip. Exit: sell all when 3-month hold allows.",
    scanNote: "At its 52-week high. Half-conviction position (5.2% weight) — too small to matter if EM wins, big enough to drag if it doesn't. Binary decision: commit to 10% allocation (200 shares) OR exit entirely. No middle ground.",
    confidence: 50,
  },
  BTC: {
    ytdPct: -26.57,
    histVolPct: 0,
    lo52: 0,
    hi52: 0,
    avgCost: 38.98,
    signal: "EXIT",
    signalColor: "red",
    entryZone: "N/A — EXIT only",
    entryTrigger: "Exit as soon as your 3-month hold period is satisfied",
    scanNote: "–27% YTD, –27% on your cost. No income. No diversification benefit. Adds volatility without offsetting any risk in the rest of the portfolio. The 3-month hold rule applies — check your purchase date. Once eligible: sell everything and move proceeds to SGOV (defensive buffer) or VT.",
    confidence: 85,
  },
}

// ─── RISK RADAR DATA ─────────────────────────────────────────────────────────

const RISKS = [
  {
    id: "R1",
    name: "SMH correction coming",
    level: "HIGH" as const,
    prob: 72,
    horizon: "Jul – Sep 2026",
    plain: "SMH has run +216% from its April 2025 low and is now at an all-time high with overbought signals on multiple indicators. Every previous time this happened in SMH's history, a 12–20% pullback followed before the next leg up.",
    portfolioHit: "SMH –15%: you lose ~$2,400 of portfolio value. SMH –25%: you lose ~$4,000.",
    whatToDo: "Don't add to SMH right now. Set price alerts at $590, $550, and $510. When the alert fires — that's your entry window.",
    recovery: "Historical recovery: 4–12 months once AI capex cycle confirmed intact.",
  },
  {
    id: "R2",
    name: "Iran War – energy shock (now two-sided)",
    level: "HIGH" as const,
    prob: 40,
    horizon: "De-escalating — but volatile",
    plain: "The US–Israel war on Iran since February 2026 disrupted shipping through the Strait of Hormuz and pushed oil up sharply. As of late June, a framework deal to end the war is close: Brent has fallen to around $78 (its lowest since early March) as markets price in Iran reopening the Strait. The risk is now two-sided — a signed deal removes the overhang and is bullish; a breakdown re-closes the Strait and spikes oil and inflation again. Reporting is genuinely fluid week to week.",
    portfolioHit: "If the deal breaks down: VT –10%, QQQM –12%, SMH –15%, portfolio NAV could drop ~SGD 20,000. If the deal signs: a relief rally, mildly positive for all equity positions.",
    whatToDo: "Hold your equities either way — do not trade the headlines. Your SGOV buffer (funded from the BTC exit) is the protection if it breaks down. Only signal worth acting on: oil sustained back above $90 = reduce SMH. A signed deal = no action needed, just let it run.",
    recovery: "If it breaks down: 4–8 weeks for US tech, assuming no Fed rate hike follows. If it signs: the overhang clears immediately.",
  },
  {
    id: "R3",
    name: "US–China tariff truce expires Nov 10",
    level: "MEDIUM" as const,
    prob: 35,
    horizon: "Nov 10, 2026",
    plain: "The 1-year tariff truce between the US and China expires on November 10, 2026. Negotiations are ongoing but not finished. If talks break down, tariffs could snap back to 2025 highs — which caused SMH to drop 17% in two weeks last time.",
    portfolioHit: "Tariff breakdown: SMH –15 to –20% in 2 weeks. QQQM –10%. Total NAV hit: ~SGD 12,000–15,000.",
    whatToDo: "Watch the news from September onwards. If talks are going badly by October, reduce your SMH position by 5–8 shares. On breakdown: do NOT sell on day 1. Set limit buy orders for week 2–3. Recovery has always come within 6 weeks.",
    recovery: "Policy Shock pattern: resolution within 6–8 weeks of a deal or extension.",
  },
  {
    id: "R4",
    name: "Fed rate hike (not cut) risk",
    level: "MEDIUM" as const,
    prob: 30,
    horizon: "Q4 2026 – Q1 2027",
    plain: "The Fed is on hold at 3.5–3.75% and inflation (PCE 3.3%) is still above target. 9 of 19 Fed members projected at least one rate hike at the June 2026 meeting. If this happens, it's the 2022 playbook repeating — growth stocks get crushed as interest rates rise.",
    portfolioHit: "Rate hike: QQQM –15 to –20%, SMH –20%, VT –10%. Recovery takes 12–18 months.",
    whatToDo: "This is why you need the SGOV buffer now — it holds value when rates rise. Watch monthly CPI/PCE prints. If inflation re-accelerates above 3.5%, reduce QQQM by 10–15 shares as insurance.",
    recovery: "Rate cycle recovery: 12–18 months. Longest of all risk scenarios.",
  },
  {
    id: "R5",
    name: "Taiwan – catastrophic tail risk",
    level: "LOW" as const,
    prob: 8,
    horizon: "2026–2027 (tail)",
    plain: "Taiwan Semiconductor (TSMC) is roughly 10% of SMH. A military conflict around Taiwan would cause SMH to drop 30–50% and would be a structural, not cyclical, event. This is unlikely but not impossible given current geopolitical tensions.",
    portfolioHit: "Taiwan incident: SMH –30 to –50%. Portfolio NAV: –SGD 25,000 to –45,000. Cannot recover quickly.",
    whatToDo: "You can't fully hedge this without options. Best protection: keep SMH below 12% of portfolio weight. That's the cap — don't let it drift higher.",
    recovery: "Unknown — would be a structural global economic shock.",
  },
]

// ─── ACTION CALENDAR ─────────────────────────────────────────────────────────

const ACTIONS = [
  {
    when: "Right now",
    urgency: "CRITICAL" as const,
    ticker: "BTC",
    what: "Check when you bought your BTC — if it's been 3 months or more, sell all of it",
    why: "BTC is down 27% and losing you money every day. It's not diversifying your portfolio — it's just adding risk with no benefit. The proceeds (~$4,400) go into your defensive buffer.",
  },
  {
    when: "This week",
    urgency: "HIGH" as const,
    ticker: "SMH",
    what: "Set price alerts on your phone: SMH @ $590, $550, $510",
    why: "SMH is at its peak. You don't add at the peak — you prepare your orders and wait. When the alert fires, you move fast with your pre-planned tranches.",
  },
  {
    when: "This week",
    urgency: "HIGH" as const,
    ticker: "VWO",
    what: "Make a binary decision on VWO: either add 71 more shares OR sell all 129 shares",
    why: "129 shares at 5.2% of your portfolio is the worst of both worlds — not enough to matter if EM wins, enough to drag if it doesn't. Commit or exit. No middle ground.",
  },
  {
    when: "After BTC is sold",
    urgency: "HIGH" as const,
    ticker: "SGOV",
    what: "Buy SGOV (iShares 0–3 Month Treasury) — target $12,000–$15,000 worth",
    why: "This is your shock absorber. Currently yielding about 3.85% with zero equity correlation. When the next market shock hits (Iran, tariffs, rate hike), SGOV holds value while everything else drops — and you use it to buy the dip cheaply.",
  },
  {
    when: "When SMH drops to $590",
    urgency: "MEDIUM" as const,
    ticker: "SMH",
    what: "Buy Tranche 1: spend 30% of what you planned to invest in SMH",
    why: "Don't go all-in on the first dip. The three-tranche rule means you average into the entry — reducing timing risk. If SMH keeps falling, your later tranches get a better price.",
  },
  {
    when: "3 weeks after SMH bottoms",
    urgency: "MEDIUM" as const,
    ticker: "SMH",
    what: "After 3 consecutive green weekly closes: buy Tranche 2 (40% of your planned SMH investment)",
    why: "Three green weeks from the bottom is the historical confirmation signal. Every sustained SMH recovery in the last 5 years showed this pattern. Tranche 2 is the main deployment.",
  },
  {
    when: "Monthly — every month",
    urgency: "MEDIUM" as const,
    ticker: "VT",
    what: "On any week VT drops to $148 or below: buy 10–15 shares",
    why: "VT is your retirement anchor. It has the lowest volatility in your portfolio. Steady accumulation at fair prices compounds powerfully over your 2045 timeline.",
  },
  {
    when: "Sep – Oct 2026",
    urgency: "MEDIUM" as const,
    ticker: "ALL",
    what: "Monitor US–China tariff news — if negotiations are failing, reduce SMH by 5–8 shares",
    why: "The tariff truce expires Nov 10. If it's looking shaky in September, reduce your biggest risk position before the event rather than reacting after.",
  },
  {
    when: "Nov 10, 2026",
    urgency: "HIGH" as const,
    ticker: "SMH + QQQM",
    what: "If tariff talks break down: wait 2 weeks, THEN buy SMH and QQQM aggressively",
    why: "The April 2025 tariff shock was devastating for 2 weeks — then reversed completely in 6. Don't sell. Don't panic. Have your limit orders pre-set and deploy in week 2 of any breakdown.",
  },
  {
    when: "Whenever the Fed cuts rates",
    urgency: "HIGH" as const,
    ticker: "QQQM",
    what: "Execute immediately on cut announcement: buy 15 shares of QQQM, 30 shares of VT",
    why: "When the Fed cuts, QQQM historically gains 12–18% in the following 90 days. This is a same-day trade. Have your orders ready. Don't wait for confirmation — the market front-runs the cut.",
  },
]

// ─── GOVERNANCE PRINCIPLES (merged + upgraded) ────────────────────────────────

const PRINCIPLES = [
  {
    number: "01",
    name: "The 3-Month Hold Rule",
    category: "Discipline",
    plain: "Every position you buy must be held for at least 90 days before you can sell it.",
    why: "Forces conviction-based entries. Before buying anything, ask: 'Would I hold this through a 20% drop?' If the answer is no — don't buy.",
    color: "indigo",
  },
  {
    number: "02",
    name: "Never Buy at the Top",
    category: "Timing",
    plain: "Do not add to any position that is within 3% of its 52-week high, unless it's VT (your core).",
    why: "SMH and QQQM at all-time highs historically precede 12–20% pullbacks. Patience here is worth 15% in average entry price improvement.",
    color: "amber",
  },
  {
    number: "03",
    name: "The Three-Tranche Rule",
    category: "Execution",
    plain: "Never deploy your full intended capital on the first signal. Split it: 30% on first signal, 40% after 3 green weeks from trough, 30% once the trend is confirmed.",
    why: "Pattern data: day-1 buyers underperformed week-2 buyers by 8–12% across all 8 major drop-to-rise events in the last 5 years.",
    color: "violet",
  },
  {
    number: "04",
    name: "SMH Cap at 12% Weight",
    category: "Concentration",
    plain: "SMH must never exceed 12% of your total portfolio value. If it drifts above 12%, trim back to 10%.",
    why: "SMH currently generates ~50% of your active returns from 10.6% weight. That's great — but if it corrects 25%, the impact is catastrophic relative to everything else. The cap protects the compounding base.",
    color: "red",
  },
  {
    number: "05",
    name: "Exit BTC. Keep the Conviction Assets",
    category: "Position Sizing",
    plain: "BTC serves no role in a 2045 retirement portfolio at its current weight and return profile. Exit it. QQQM and SMH are conviction assets — they can run above target weight, but never above their hard caps.",
    why: "BTC is –27% and adding volatility with no income or diversification. QQQM and SMH have structural tailwinds from AI capex. Choose your battles.",
    color: "orange",
  },
  {
    number: "06",
    name: "Always Hold a 10% Shock Buffer",
    category: "Protection",
    plain: "Keep 8–10% of your portfolio in SGOV (short-duration Treasury). This is your dry powder and your shock absorber.",
    why: "You had zero defensive allocation during the April 2025 tariff shock. You recovered — but you couldn't buy the dip at its deepest because you had no cash. A 10% SGOV position fixes this permanently.",
    color: "green",
  },
  {
    number: "07",
    name: "Policy Shocks are Buying Opportunities",
    category: "Pattern",
    plain: "When a tariff announcement, geopolitical event, or regulatory shock causes a market drop of >10%: do NOT sell. Wait 2 weeks, then deploy your shock buffer into the dip.",
    why: "100% of policy shocks in the last 5 years reversed within 8 weeks. The recoveries averaged +22%. Panicking costs you the best returns of the year.",
    color: "cyan",
  },
  {
    number: "08",
    name: "Macro Shocks Require Patience",
    category: "Pattern",
    plain: "When a rate hike cycle or structural macro shift causes a sustained drop (months, not weeks): hold everything. Continue monthly contributions. Do not redesign the portfolio.",
    why: "The 2022 rate cycle dropped everything 25–40%. The people who held and kept contributing are up 100%+ today. The people who sold are not.",
    color: "blue",
  },
  {
    number: "09",
    name: "Half-Conviction is Worse than Zero",
    category: "Position Sizing",
    plain: "If a position isn't large enough to meaningfully move your returns when it wins, it will still meaningfully hurt you when it loses. Either size it properly or exit it.",
    why: "VWO at 5.2% is the perfect example. It can drop 15% and knock $1,200 off your NAV — but it would need to go up 40% to add $3,200. The maths doesn't work.",
    color: "purple",
  },
  {
    number: "10",
    name: "The Monthly 5-Minute Check",
    category: "Execution",
    plain: "Once a month: check if any hard cap is breached → if yes, trim. Then check if anything is underweight → deploy contribution there. Then check for macro triggers → act if needed. Otherwise: do nothing.",
    why: "The biggest destroyer of long-term returns is over-trading. The governance engine works on discipline and patience, not on watching prices every day.",
    color: "slate",
  },
]

// ─── COLOUR HELPERS ──────────────────────────────────────────────────────────

const LEVEL_STYLES = {
  HIGH: "bg-red-500/10 text-red-600 dark:text-red-400 ring-1 ring-red-500/25",
  MEDIUM: "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/25",
  LOW: "bg-slate-500/10 text-slate-500 ring-1 ring-slate-500/20",
} as const

const URGENCY_STYLES = {
  CRITICAL: { dot: "bg-red-500", border: "border-red-500/25 bg-red-500/[0.04]", badge: "bg-red-500/10 text-red-600 dark:text-red-400" },
  HIGH: { dot: "bg-amber-500", border: "border-amber-500/25 bg-amber-500/[0.04]", badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  MEDIUM: { dot: "bg-blue-500", border: "border-border bg-card", badge: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
} as const

const SIGNAL_STYLES = {
  BUY: "bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500/25",
  HOLD: "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/25",
  WATCH: "bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/25",
  EXIT: "bg-red-500/10 text-red-600 dark:text-red-400 ring-1 ring-red-500/25",
  DECIDE: "bg-orange-500/10 text-orange-600 dark:text-orange-400 ring-1 ring-orange-500/25",
} as const

const PRINCIPLE_COLORS: Record<string, string> = {
  indigo: "border-indigo-500/30 bg-indigo-500/[0.04]",
  amber: "border-amber-500/30 bg-amber-500/[0.04]",
  violet: "border-violet-500/30 bg-violet-500/[0.04]",
  red: "border-red-500/30 bg-red-500/[0.04]",
  orange: "border-orange-500/30 bg-orange-500/[0.04]",
  green: "border-green-500/30 bg-green-500/[0.04]",
  cyan: "border-cyan-500/30 bg-cyan-500/[0.04]",
  blue: "border-blue-500/30 bg-blue-500/[0.04]",
  purple: "border-purple-500/30 bg-purple-500/[0.04]",
  slate: "border-slate-500/30 bg-slate-500/[0.04]",
}

const PRINCIPLE_BADGE_COLORS: Record<string, string> = {
  indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  red: "bg-red-500/10 text-red-600 dark:text-red-400",
  orange: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  green: "bg-green-500/10 text-green-600 dark:text-green-400",
  cyan: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  purple: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  slate: "bg-slate-500/10 text-slate-500",
}

function ConfBar({ value, className }: { value: number; className?: string }) {
  const col = value >= 70 ? "bg-green-500" : value >= 45 ? "bg-amber-500" : "bg-red-500"
  return (
    <div className={cn("h-1.5 w-full rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full", col)} style={{ width: `${value}%` }} />
    </div>
  )
}

// ─── TAB DEFINITIONS ─────────────────────────────────────────────────────────

const TABS = [
  { id: "scanner",    label: "What to Do",    icon: Search },
  { id: "risks",      label: "Risks Ahead",   icon: Shield },
  { id: "calendar",  label: "When to Act",   icon: Calendar },
  { id: "principles",label: "The Rules",      icon: Zap },
] as const

type TabId = typeof TABS[number]["id"]

// ─── NEXT BEST MOVE SEVERITY STYLES ──────────────────────────────────────────

const NBM_SEVERITY = {
  critical: { Icon: ShieldAlert, ring: "border-red-500/50", bg: "bg-red-500/[0.07]", iconBg: "bg-red-500/20", iconColor: "text-red-500", label: "Do this first", labelColor: "text-red-600 dark:text-red-400" },
  high:     { Icon: AlertTriangle, ring: "border-amber-500/50", bg: "bg-amber-500/[0.06]", iconBg: "bg-amber-500/20", iconColor: "text-amber-500", label: "Your next move", labelColor: "text-amber-700 dark:text-amber-400" },
  medium:   { Icon: Zap, ring: "border-indigo-500/40", bg: "bg-indigo-500/[0.05]", iconBg: "bg-indigo-500/20", iconColor: "text-indigo-500", label: "Your next move", labelColor: "text-indigo-700 dark:text-indigo-400" },
  low:      { Icon: TrendingUp, ring: "border-blue-500/40", bg: "bg-blue-500/[0.04]", iconBg: "bg-blue-500/20", iconColor: "text-blue-500", label: "Your next move", labelColor: "text-blue-700 dark:text-blue-400" },
  none:     { Icon: CheckCircle2, ring: "border-green-500/40", bg: "bg-green-500/[0.04]", iconBg: "bg-green-500/20", iconColor: "text-green-500", label: "You're on track", labelColor: "text-green-700 dark:text-green-400" },
} as const

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export function CommandCentreClient({ positions, totalValue, nextBestMove }: Props) {
  const [tab, setTab] = useState<TabId>("scanner")
  const [openRisk, setOpenRisk] = useState<string | null>(null)
  const [openScan, setOpenScan] = useState<string | null>(null)
  const [openAction, setOpenAction] = useState<number | null>(null)

  // Merge DB positions with market data
  const enriched = positions.map((p) => ({
    ...p,
    market: MARKET_DATA[p.ticker] ?? null,
    returnPct: MARKET_DATA[p.ticker]
      ? ((p.latestPrice - MARKET_DATA[p.ticker].avgCost) / MARKET_DATA[p.ticker].avgCost) * 100
      : null,
    weightPct: totalValue > 0 ? (p.latestValue / totalValue) * 100 : 0,
  }))

  const alertCount = RISKS.filter((r) => r.level === "HIGH").length
  const criticalActions = ACTIONS.filter((a) => a.urgency === "CRITICAL").length

  const nbmCfg = NBM_SEVERITY[nextBestMove.severity]

  return (
    <div className="space-y-5">

      {/* ═══ NEXT BEST MOVE — the single clearest action, always on top ═══ */}
      <div className={cn("rounded-2xl border-2 overflow-hidden", nbmCfg.ring, nbmCfg.bg)}>
        <div className="px-5 pt-4 pb-2 flex items-center gap-2">
          <span className={cn("text-[11px] font-black uppercase tracking-widest", nbmCfg.labelColor)}>
            {nbmCfg.label}
          </span>
          <div className="h-px flex-1 bg-current opacity-10" />
          <span className="text-[10px] font-semibold text-muted-foreground px-2 py-0.5 rounded-full bg-background/60">
            {nextBestMove.ticker}
          </span>
        </div>
        <div className="px-5 pb-5">
          <div className="flex items-start gap-4">
            <div className={cn("shrink-0 flex h-12 w-12 items-center justify-center rounded-xl", nbmCfg.iconBg)}>
              <nbmCfg.Icon className={cn("h-6 w-6", nbmCfg.iconColor)} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-black tracking-tight leading-tight mb-2">{nextBestMove.action}</h2>
              <div className="space-y-2.5">
                <div className="flex gap-2">
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground mt-0.5 w-10">Do</span>
                  <p className="text-sm text-foreground leading-relaxed">{nextBestMove.what}</p>
                </div>
                <div className="flex gap-2">
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground mt-0.5 w-10">Why</span>
                  <p className="text-sm text-muted-foreground leading-relaxed">{nextBestMove.why}</p>
                </div>
                <div className="flex gap-2">
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground mt-0.5 w-10">When</span>
                  <p className="text-sm text-muted-foreground leading-relaxed">{nextBestMove.when}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Top summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Risks active</span>
            <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
          </div>
          <p className="text-2xl font-black text-red-500">{alertCount}</p>
          <p className="text-[11px] text-muted-foreground">High priority</p>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Do right now</span>
            <Flame className="h-3.5 w-3.5 text-amber-500" />
          </div>
          <p className="text-2xl font-black text-amber-500">{criticalActions}</p>
          <p className="text-[11px] text-muted-foreground">Critical action</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Portfolio NAV</span>
            <TrendingUp className="h-3.5 w-3.5 text-green-500" />
          </div>
          <p className="text-2xl font-black text-green-500">
            {totalValue > 0 ? `$${(totalValue / 1000).toFixed(0)}k` : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground">SGD equivalent</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Rules active</span>
            <Shield className="h-3.5 w-3.5 text-indigo-500" />
          </div>
          <p className="text-2xl font-black text-indigo-500">{PRINCIPLES.length}</p>
          <p className="text-[11px] text-muted-foreground">Governance principles</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex rounded-xl border border-border bg-card p-1 gap-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-all",
              tab === id
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-muted-foreground hover:bg-accent/80 hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* ═══ SCANNER: WHAT TO DO ════════════════════════════════════════════ */}
      {tab === "scanner" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.04] p-4">
            <div className="flex gap-2">
              <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-semibold text-foreground">Live market scanner</span> — reads your live positions against current price levels, volatility, and pattern signals. BUY means act. HOLD means wait. EXIT means sell when your 3-month hold window allows.
              </p>
            </div>
          </div>

          {enriched.map((pos) => {
            const md = pos.market
            if (!md) return null
            const isOpen = openScan === pos.ticker
            const signalStyle = SIGNAL_STYLES[md.signal]

            return (
              <div
                key={pos.ticker}
                className={cn(
                  "rounded-xl border bg-card overflow-hidden cursor-pointer transition-colors hover:bg-accent/30",
                  isOpen ? "border-indigo-500/30" : "border-border"
                )}
                onClick={() => setOpenScan(isOpen ? null : pos.ticker)}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-2 rounded-full shrink-0 mt-1" style={{ backgroundColor: pos.color }} />
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm">{pos.ticker}</span>
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", signalStyle)}>
                            {md.signal}
                          </span>
                          {pos.returnPct !== null && (
                            <span className={cn("text-[10px] font-semibold", pos.returnPct >= 0 ? "text-green-500" : "text-red-500")}>
                              {pos.returnPct >= 0 ? "+" : ""}{pos.returnPct.toFixed(0)}% on cost
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{pos.name}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-black">${pos.latestPrice.toFixed(2)}</p>
                      <p className={cn("text-[11px] font-semibold", md.ytdPct >= 0 ? "text-green-500" : "text-red-500")}>
                        {md.ytdPct >= 0 ? "+" : ""}{md.ytdPct.toFixed(1)}% YTD
                      </p>
                    </div>
                  </div>

                  {/* 52w range bar */}
                  {md.lo52 > 0 && (
                    <div className="mt-3">
                      <div className="flex justify-between text-[9px] text-muted-foreground mb-1">
                        <span>52w low ${md.lo52.toFixed(0)}</span>
                        <span>Now ${pos.latestPrice.toFixed(0)}</span>
                        <span>52w high ${md.hi52.toFixed(0)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted relative">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-green-500 to-amber-500"
                          style={{ width: `${Math.min(100, ((pos.latestPrice - md.lo52) / (md.hi52 - md.lo52)) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-2">
                    <div>
                      <span className="text-[10px] text-muted-foreground">Confidence: </span>
                      <span className={cn("text-[10px] font-bold",
                        md.confidence >= 70 ? "text-green-500" : md.confidence >= 50 ? "text-amber-500" : "text-red-500"
                      )}>{md.confidence}%</span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {isOpen ? "less" : "see rationale + entry"}
                    </div>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-border px-4 pb-4 pt-3 space-y-3">
                    <p className="text-xs text-muted-foreground leading-relaxed">{md.scanNote}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-green-500/20 bg-green-500/[0.06] p-3">
                        <p className="text-[9px] font-bold text-green-500 uppercase tracking-wide mb-1">Entry Zone</p>
                        <p className="text-xs font-semibold">{md.entryZone}</p>
                      </div>
                      <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/[0.06] p-3">
                        <p className="text-[9px] font-bold text-indigo-500 uppercase tracking-wide mb-1">Trigger</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{md.entryTrigger}</p>
                      </div>
                    </div>
                    {md.histVolPct > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">Annual volatility:</span>
                        <span className={cn("text-[10px] font-bold",
                          md.histVolPct < 25 ? "text-green-500" : md.histVolPct < 40 ? "text-amber-500" : "text-red-500"
                        )}>{md.histVolPct.toFixed(1)}% {md.histVolPct >= 40 ? "(elevated — be careful)" : ""}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* New position: SGOV */}
          <div className="rounded-xl border border-green-500/30 bg-green-500/[0.04] p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500/25">
                BUY — NEW
              </span>
              <span className="font-bold text-sm">SGOV</span>
              <span className="text-xs text-muted-foreground">iShares 0–3 Month Treasury Bill</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">Your missing layer.</span>{" "}
              Currently yielding about 3.85%. Zero equity correlation. When the next shock hits, SGOV holds value — and gives you dry powder to buy the dip. Target: $12,000–$15,000 (8–10% of NAV). Fund from BTC exit proceeds.
            </p>
            <div className="mt-2 text-[11px] text-green-600 dark:text-green-400 font-semibold flex items-center gap-1">
              <ArrowRight className="h-3 w-3" /> Buy at market — no timing required. Do this the same day BTC is sold.
            </div>
          </div>
        </div>
      )}

      {/* ═══ RISKS AHEAD ════════════════════════════════════════════════════ */}
      {tab === "risks" && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {(["HIGH", "MEDIUM", "LOW"] as const).map((level) => {
              const count = RISKS.filter((r) => r.level === level).length
              const styles = {
                HIGH: { border: "border-red-500/20", text: "text-red-500", label: "High priority" },
                MEDIUM: { border: "border-amber-500/20", text: "text-amber-500", label: "Watch closely" },
                LOW: { border: "border-border", text: "text-muted-foreground", label: "Tail risks" },
              }[level]
              return (
                <div key={level} className={cn("rounded-xl border bg-card p-3 text-center", styles.border)}>
                  <p className={cn("text-2xl font-black", styles.text)}>{count}</p>
                  <p className="text-[10px] text-muted-foreground">{styles.label}</p>
                </div>
              )
            })}
          </div>

          {RISKS.map((risk) => {
            const isOpen = openRisk === risk.id
            const lvlStyle = LEVEL_STYLES[risk.level]
            return (
              <div
                key={risk.id}
                className={cn(
                  "rounded-xl border bg-card overflow-hidden cursor-pointer transition-colors hover:bg-accent/30",
                  isOpen ? "border-indigo-500/30" : "border-border"
                )}
                onClick={() => setOpenRisk(isOpen ? null : risk.id)}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", lvlStyle)}>
                          {risk.level}
                        </span>
                        <span className="text-sm font-bold">{risk.name}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{risk.horizon}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cn("text-lg font-black",
                        risk.prob >= 60 ? "text-red-500" : risk.prob >= 35 ? "text-amber-500" : "text-muted-foreground"
                      )}>{risk.prob}%</p>
                      <p className="text-[9px] text-muted-foreground">probability</p>
                    </div>
                  </div>
                  <ConfBar
                    value={risk.prob}
                    className="mt-2"
                  />
                  <div className="flex justify-end mt-1.5">
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {isOpen ? "collapse" : "what does this mean + what to do"}
                    </span>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-border px-4 pb-4 pt-3 space-y-3">
                    <div className="space-y-2">
                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide mb-1">What&apos;s happening</p>
                        <p className="text-xs leading-relaxed">{risk.plain}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.05] p-3">
                          <p className="text-[9px] font-bold text-red-500 uppercase tracking-wide mb-1">Portfolio impact</p>
                          <p className="text-xs text-muted-foreground leading-relaxed">{risk.portfolioHit}</p>
                        </div>
                        <div className="rounded-lg border border-green-500/20 bg-green-500/[0.05] p-3">
                          <p className="text-[9px] font-bold text-green-500 uppercase tracking-wide mb-1">What to do</p>
                          <p className="text-xs text-muted-foreground leading-relaxed">{risk.whatToDo}</p>
                        </div>
                      </div>
                      <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.05] p-3">
                        <p className="text-[9px] font-bold text-blue-500 uppercase tracking-wide mb-1">Recovery expectation</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{risk.recovery}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ═══ CALENDAR: WHEN TO ACT ══════════════════════════════════════════ */}
      {tab === "calendar" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.04] p-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">Exact actions, exact timing.</span>{" "}
              Everything here is in plain English. Nothing is vague. The 3-month hold rule is already baked in — each buy recommendation accounts for it. Critical actions need to happen this week.
            </p>
          </div>

          {ACTIONS.map((action, i) => {
            const isOpen = openAction === i
            const styles = URGENCY_STYLES[action.urgency]
            return (
              <div
                key={i}
                className={cn(
                  "rounded-xl border overflow-hidden cursor-pointer transition-colors hover:bg-accent/30",
                  styles.border,
                  isOpen ? "border-indigo-500/30" : ""
                )}
                onClick={() => setOpenAction(isOpen ? null : i)}
              >
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={cn("h-2 w-2 rounded-full shrink-0 mt-1.5", styles.dot)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", styles.badge)}>
                          {action.urgency}
                        </span>
                        <span className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {action.when}
                        </span>
                        <span className="text-[10px] font-bold text-indigo-400">{action.ticker}</span>
                      </div>
                      <p className="text-sm font-semibold leading-snug">{action.what}</p>
                    </div>
                    <div className="shrink-0">
                      {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                </div>
                {isOpen && (
                  <div className="border-t border-border px-4 py-3 bg-muted/20">
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      <span className="font-semibold text-foreground">Why: </span>
                      {action.why}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ═══ PRINCIPLES: THE RULES ══════════════════════════════════════════ */}
      {tab === "principles" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/[0.04] p-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">10 principles that make you richer faster.</span>{" "}
              These integrate your existing V5.8 governance framework with the new pattern-recognition rules derived from 5 years of portfolio history. Follow them in order of precedence — the lower the number, the higher the priority.
            </p>
          </div>

          <div className="space-y-2">
            {PRINCIPLES.map((p) => (
              <div
                key={p.number}
                className={cn("rounded-xl border p-4", PRINCIPLE_COLORS[p.color])}
              >
                <div className="flex items-start gap-3">
                  <div className="text-xl font-black text-muted-foreground/40 shrink-0 w-7 leading-none mt-0.5">
                    {p.number}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="text-sm font-bold">{p.name}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", PRINCIPLE_BADGE_COLORS[p.color])}>
                        {p.category}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-foreground mb-2 leading-relaxed">{p.plain}</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      <span className="font-semibold text-foreground/70">Why it works: </span>
                      {p.why}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* One-line summary */}
          <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-500/[0.06] to-violet-500/[0.06] p-5">
            <p className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-2">The strategy in one paragraph</p>
            <p className="text-sm text-foreground leading-relaxed">
              <span className="font-bold">Exit BTC</span> and immediately buy SGOV as your shock absorber.{" "}
              <span className="font-bold">Hold SMH and QQQM</span> — do not add at current highs.{" "}
              When SMH corrects to $590 or below (it will — it always does after a run like this), <span className="font-bold">deploy in three tranches</span>.{" "}
              <span className="font-bold">Accumulate VT steadily</span> — it&apos;s your 2045 compounding engine.{" "}
              <span className="font-bold">Make a binary VWO decision</span>: 200 shares or zero.{" "}
              Watch <span className="font-bold">November 10</span> for the tariff expiry — it&apos;s either a non-event or the best buying window of the year.{" "}
              If the <span className="font-bold">Fed cuts rates</span>, buy QQQM the same day.{" "}
              Patient at highs. Aggressive at lows. Protected in between.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
