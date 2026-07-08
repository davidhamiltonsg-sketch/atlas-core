"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  ShieldCheck, GitCompare, TrendingUp, Landmark, BarChart3, Coins, Brain,
  Activity, Radar, Gauge, ArrowLeft, Play, Square, Zap, CircleDot, AlertTriangle,
} from "lucide-react"

// ─────────────────────────────────────────────────────────────────────────────
// Mission Control — a live agent dispatch console.
//
// This is a deliberately OFF-THEME surface: a dark command-centre that stands
// apart from the app's violet/azure dashboards. Every colour is hard-coded from
// the mission-control palette so it never re-skins with the constitution theme.
//
//   navy   #0A0F1E  base            gold  #C9A84C  wealth / precision accent
//   card   #1A2035  surface         blue  #4A9EFF  data / AI
//   line   #26304A  hairline        green #2ECC9A  positive signal
//   text   #C7D0E4  body            red   #E05555  alert
//
// The "agents" are the app's real analytical engines. Dispatching one streams
// its findings into the ops feed and flips its tile to ACTIVE. Both Atlas and
// SBR agents compute live findings from real portfolio data (passed as
// `findings` from the server). When findings are unavailable (logged out, no
// session), the component falls back to scripted traces. Nothing here mutates
// portfolio data.
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  navy: "#0A0F1E",
  terminal: "#060C18",
  card: "#1A2035",
  cardHi: "#212a45",
  line: "#26304A",
  timestamp: "#3A4D6A",
  dim: "#7C89A8",
  text: "#C7D0E4",
  label: "#EAEEF6",
  bright: "#F5F7FF",
  gold: "#C9A84C",
  blue: "#4A9EFF",
  green: "#2ECC9A",
  red: "#E05555",
} as const

type Level = "info" | "data" | "ok" | "warn" | "err"
type AgentStatus = "idle" | "active" | "done" | "alert"

const LEVEL_COLOR: Record<Level, string> = {
  info: C.dim,
  data: C.blue,
  ok: C.green,
  warn: C.gold,
  err: C.red,
}

interface Step { t: number; level: Level; msg: string }
interface AgentDef {
  id: string
  name: string
  codename: string
  blurb: string
  icon: React.ElementType
  accent: string
  script: Step[]
  /** final resting state once the run completes */
  result: { status: Exclude<AgentStatus, "idle" | "active">; line: Step }
}

// The Atlas roster — one tile per real Atlas engine. Scripts reference the
// actual domain (drift bands, the decision ladder, 13F clusters, the SBR phase
// gate) so the feed reads like a genuine governance run.
const ATLAS_AGENTS: AgentDef[] = [
  {
    id: "constitution",
    name: "Constitution Auditor",
    codename: "ATLAS-CON",
    blurb: "Cross-checks every threshold against the Constitution",
    icon: ShieldCheck,
    accent: C.gold,
    script: [
      { t: 120, level: "info", msg: "Loading Constitution v5.8 · 41 numeric clauses" },
      { t: 620, level: "data", msg: "Reconciling drift bands · caps · crash ladder" },
      { t: 1180, level: "data", msg: "39/41 clauses matched to code constants" },
      { t: 1720, level: "warn", msg: "SGOV crash-deploy trigger reads 18% vs clause 22 (20%)" },
      { t: 2280, level: "info", msg: "Compiling remediation note for governance log" },
    ],
    result: { status: "alert", line: { t: 2700, level: "warn", msg: "1 threshold drifted from constitution — flagged for review" } },
  },
  {
    id: "governance",
    name: "Governance Sentinel",
    codename: "ATLAS-GOV",
    blurb: "Enforces rules, caps and the monthly cadence",
    icon: Gauge,
    accent: C.blue,
    script: [
      { t: 120, level: "info", msg: "Evaluating hard caps across 9 sleeves" },
      { t: 640, level: "data", msg: "Single-name cap 15% · sector cap 35% · cash floor 2%" },
      { t: 1200, level: "ok", msg: "All caps within tolerance band" },
      { t: 1740, level: "data", msg: "Monthly check window: 4 days remaining" },
    ],
    result: { status: "done", line: { t: 2200, level: "ok", msg: "Governance clean — 0 breaches, seal renewed" } },
  },
  {
    id: "drift",
    name: "Drift Monitor",
    codename: "ATLAS-DRIFT",
    blurb: "Watches allocation drift against target bands",
    icon: Radar,
    accent: C.green,
    script: [
      { t: 120, level: "info", msg: "Sampling live weights vs target model" },
      { t: 700, level: "data", msg: "Growth sleeve +2.9% · tolerance ±2.5%" },
      { t: 1260, level: "warn", msg: "Growth sleeve breached upper band" },
      { t: 1820, level: "data", msg: "Core index −1.4% · within band" },
    ],
    result: { status: "alert", line: { t: 2300, level: "warn", msg: "1 sleeve out of band — rebalance candidate queued" } },
  },
  {
    id: "rebalance",
    name: "Rebalance Engine",
    codename: "ATLAS-RBAL",
    blurb: "Runs the decision ladder for the next best move",
    icon: GitCompare,
    accent: C.gold,
    script: [
      { t: 120, level: "info", msg: "Descending decision ladder · rung 1 → 5" },
      { t: 700, level: "data", msg: "Rung 2: contribution-only correction feasible" },
      { t: 1320, level: "data", msg: "Route $3,000 monthly into core index" },
      { t: 1900, level: "ok", msg: "No sell required — tax-neutral path found" },
    ],
    result: { status: "done", line: { t: 2400, level: "ok", msg: "Plan ready: 1 buy leg, band restored in 2 cycles" } },
  },
  {
    id: "smartmoney",
    name: "Smart Money",
    codename: "ATLAS-13F",
    blurb: "Clusters institutional 13F positioning",
    icon: Landmark,
    accent: C.blue,
    script: [
      { t: 120, level: "info", msg: "Ingesting latest 13F filings · 214 managers" },
      { t: 780, level: "data", msg: "Consensus adds: quality compounders, short-duration" },
      { t: 1400, level: "data", msg: "Overlap with portfolio: 61% by weight" },
      { t: 1980, level: "info", msg: "No conviction divergence beyond threshold" },
    ],
    result: { status: "done", line: { t: 2500, level: "ok", msg: "Positioning aligned with smart-money consensus" } },
  },
  {
    id: "forecast",
    name: "Forecast Engine",
    codename: "ATLAS-FCST",
    blurb: "Projects glide path to the funding goal",
    icon: TrendingUp,
    accent: C.green,
    script: [
      { t: 120, level: "info", msg: "Blending realised growth from 9 holdings" },
      { t: 760, level: "data", msg: "Weighted CAGR 8.4% · contribution growth 5%" },
      { t: 1380, level: "data", msg: "Monte-Carlo · 2,000 paths · p50 / p10 / p90" },
      { t: 2000, level: "ok", msg: "Goal reached p50 in 7.2y · p10 in 9.6y" },
    ],
    result: { status: "done", line: { t: 2500, level: "ok", msg: "Forecast refreshed — on track at median" } },
  },
  {
    id: "risk",
    name: "Risk Analyzer",
    codename: "ATLAS-RISK",
    blurb: "Measures concentration and annualised vol",
    icon: BarChart3,
    accent: C.gold,
    script: [
      { t: 120, level: "info", msg: "Building return timeline · 18 snapshots" },
      { t: 720, level: "data", msg: "Annualised vol 12.1% · max drawdown −9.3%" },
      { t: 1320, level: "data", msg: "Top-3 concentration 44% of book" },
      { t: 1900, level: "warn", msg: "Bitcoin sleeve contributes 38% of variance" },
    ],
    result: { status: "alert", line: { t: 2400, level: "warn", msg: "Concentration elevated — monitor crypto sleeve" } },
  },
  {
    id: "dividends",
    name: "Dividend Tracker",
    codename: "ATLAS-DIV",
    blurb: "Reconciles income and reinvestment",
    icon: Coins,
    accent: C.blue,
    script: [
      { t: 120, level: "info", msg: "Matching cash transactions to holdings" },
      { t: 700, level: "data", msg: "Trailing-12m yield 1.9% · $4,120 received" },
      { t: 1260, level: "ok", msg: "All distributions reconciled to snapshots" },
    ],
    result: { status: "done", line: { t: 1700, level: "ok", msg: "Income ledger balanced — 0 unmatched" } },
  },
  {
    id: "sbr",
    name: "SBR Engine",
    codename: "SBR-PHASE",
    blurb: "Runs the Silicon Brick Road phase gate",
    icon: Brain,
    accent: C.green,
    script: [
      { t: 120, level: "info", msg: "Reading SBR constitution v2.2 · phase logic" },
      { t: 720, level: "data", msg: "Portfolio $71.4k · phase A gate at $96k" },
      { t: 1320, level: "data", msg: "Whole-share accrual bank: S$412 carried" },
      { t: 1900, level: "info", msg: "Phase B unlocks in ~8 monthly cycles" },
    ],
    result: { status: "done", line: { t: 2400, level: "ok", msg: "SBR on Phase A track — accrual healthy" } },
  },
]

// The Silicon Brick Road roster — same console, but plain-English helpers with
// no jargon (per the SBR constitution: no "DCA", "drift band", "look-through",
// "FX", "dealing window"). One Mission Control, two portfolios: an SBR user sees
// friendly helpers about bricks, the road, and the home deposit — never the
// Atlas governance vocabulary.
const SBR_AGENTS: AgentDef[] = [
  {
    id: "buys",
    name: "This Month's Shares",
    codename: "BUYS",
    blurb: "Turns this month's money into whole shares",
    icon: Coins,
    accent: C.gold,
    script: [
      { t: 120, level: "info", msg: "Splitting this month's savings across your four funds" },
      { t: 700, level: "data", msg: "Buying only whole shares · carrying the rest forward" },
      { t: 1300, level: "data", msg: "3 × global fund · 1 × Singapore bond fund" },
    ],
    result: { status: "done", line: { t: 1800, level: "ok", msg: "Buy list ready — a little carries to next month" } },
  },
  {
    id: "balance",
    name: "Balance Check",
    codename: "BALANCE",
    blurb: "Keeps the four funds near their targets",
    icon: Gauge,
    accent: C.blue,
    script: [
      { t: 120, level: "info", msg: "Weighing each fund against its guide-rails" },
      { t: 720, level: "data", msg: "Global 60% · bonds 20% · Nasdaq 10% · chips 10%" },
      { t: 1320, level: "warn", msg: "Chip-maker fund sitting a little high" },
    ],
    result: { status: "alert", line: { t: 1800, level: "warn", msg: "One fund a bit high — even it out over the next month" } },
  },
  {
    id: "road",
    name: "Where You Are",
    codename: "ROAD",
    blurb: "Your place on the road to the home",
    icon: Radar,
    accent: C.green,
    script: [
      { t: 120, level: "info", msg: "Counting the months you've saved" },
      { t: 720, level: "data", msg: "Building-up phase · still adding every month" },
    ],
    result: { status: "done", line: { t: 1300, level: "ok", msg: "On the road — next milestone is the halfway safety step" } },
  },
  {
    id: "safety",
    name: "Safety Steps",
    codename: "SAFETY",
    blurb: "Watches for the de-risking milestones",
    icon: ShieldCheck,
    accent: C.gold,
    script: [
      { t: 120, level: "info", msg: "Checking whether any safety step has started" },
      { t: 760, level: "data", msg: "First step: move new money to safety at month 18" },
    ],
    result: { status: "done", line: { t: 1300, level: "ok", msg: "No safety steps yet — you're still building up" } },
  },
  {
    id: "goal",
    name: "Goal Check",
    codename: "GOAL",
    blurb: "Projects your pot out to the home deadline",
    icon: TrendingUp,
    accent: C.green,
    script: [
      { t: 120, level: "info", msg: "Growing your seed and monthly savings to mid-2029" },
      { t: 780, level: "data", msg: "Steady-markets case lands around S$57.7K" },
    ],
    result: { status: "done", line: { t: 1300, level: "ok", msg: "On track — comfortably above your safety floor" } },
  },
  {
    id: "savings",
    name: "Savings So Far",
    codename: "SAVINGS",
    blurb: "Tallies what you've set aside",
    icon: Landmark,
    accent: C.blue,
    script: [
      { t: 120, level: "info", msg: "Adding up every deposit you've made" },
      { t: 720, level: "data", msg: "Deposits landing on schedule each month" },
    ],
    result: { status: "done", line: { t: 1200, level: "ok", msg: "Savings on plan — keep laying one brick a month" } },
  },
]

// ── Server-computed agent findings (both Atlas and SBR) ─────────────────────
export interface AgentFinding {
  script: Array<{ t: number; level: Level; msg: string }>
  result: { status: "done" | "alert"; line: { t: number; level: Level; msg: string } }
}

// ── Portfolio context (passed from the server; representative if logged out) ──
export interface PortfolioContext {
  label: string
  totalValue: number
  currency: string
  dayChangePct: number | null
  cashPct: number | null
  holdings: { ticker: string; name: string; pct: number; color: string }[]
  driftAlerts: number
  live: boolean
  variant: "atlas" | "sbr"
}

// Per-portfolio wording. The console is one component; only the roster and a few
// labels change so an SBR user never meets Atlas's ops vocabulary.
const COPY = {
  atlas: {
    roster: "AGENT ROSTER", log: "EXECUTION LOG", dispatch: "DISPATCH", sweep: "SWEEP ALL",
    subtitle: "AGENT DISPATCH", online: "Mission control online — awaiting dispatch",
    spinup: "▶ dispatch received — engine spinning up",
    sweepMsg: (n: number) => `━━ full governance sweep · ${n} agents dispatched ━━`,
    codenameLabel: "CODENAME", ctx: "PORTFOLIO CONTEXT", alloc: "ALLOCATION",
    driftText: (n: number) => `${n} drift`, showCash: true,
    flaggedTitle: "FLAGGED — NEEDS REVIEW", historyTitle: "SWEEP HISTORY",
    unit: "agents", flaggedWord: "flagged", noSweeps: "No sweeps yet — run one to build history.",
  },
  sbr: {
    roster: "HELPERS", log: "ACTIVITY", dispatch: "RUN", sweep: "RUN ALL",
    subtitle: "LIVE CHECKS", online: "Control room online — press run on any helper",
    spinup: "▶ running — checking now",
    sweepMsg: (n: number) => `━━ running all ${n} helpers ━━`,
    codenameLabel: "HELPER", ctx: "YOUR FUND", alloc: "YOUR FUNDS",
    driftText: (n: number) => `${n} to even out`, showCash: false,
    flaggedTitle: "NEEDS A LOOK", historyTitle: "CHECK-UP HISTORY",
    unit: "helpers", flaggedWord: "to look at", noSweeps: "No check-ups yet — press Run All.",
  },
} as const

interface LogLine { id: number; time: string; codename: string; accent: string; level: Level; msg: string }
interface Flag { name: string; codename: string; accent: string; msg: string }
interface SweepRun { id: number; time: string; total: number; alerts: Flag[] }

const fmtMoney = (n: number, ccy: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n)

function clockNow() {
  const d = new Date()
  return d.toLocaleTimeString("en-GB", { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0").slice(0, 2)
}

export function MissionControl({ context, findings }: { context: PortfolioContext; findings?: Record<string, AgentFinding> | null }) {
  const AGENTS = useMemo(() => {
    const base = context.variant === "sbr" ? SBR_AGENTS : ATLAS_AGENTS
    if (!findings) return base
    return base.map(a => {
      const f = findings[a.id]
      if (!f) return a
      return { ...a, script: f.script as Step[], result: { status: f.result.status as Exclude<AgentStatus, "idle" | "active">, line: f.result.line as Step } }
    })
  }, [context.variant, findings])
  const copy = COPY[context.variant]
  const brand = context.variant === "sbr" ? C.blue : C.gold

  const [status, setStatus] = useState<Record<string, AgentStatus>>(() =>
    Object.fromEntries(AGENTS.map(a => [a.id, "idle" as AgentStatus])))
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [log, setLog] = useState<LogLine[]>([
    { id: -1, time: "00:00:00.00", codename: "SYSTEM", accent: C.dim, level: "info", msg: copy.online },
  ])
  const [selected, setSelected] = useState<string>(AGENTS[0].id)
  const [clock, setClock] = useState("")
  const [sweeps, setSweeps] = useState<SweepRun[]>([])

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>[]>>({})
  const logIdRef = useRef(0)
  const sweepIdRef = useRef(0)
  const logScrollRef = useRef<HTMLDivElement | null>(null)

  // Live header clock (client-only → no hydration mismatch). The first tick is
  // deferred via rAF so we never setState synchronously inside the effect body.
  useEffect(() => {
    const tick = () => setClock(clockNow())
    const raf = requestAnimationFrame(tick)
    const iv = setInterval(tick, 1000)
    return () => { cancelAnimationFrame(raf); clearInterval(iv) }
  }, [])

  // Keep the ops feed pinned to its newest line — scroll the log's OWN container,
  // never the page, so the roster, flagged panel and history stay put during a sweep.
  useEffect(() => {
    const el = logScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  // Clear every scheduled timer on unmount.
  useEffect(() => () => { Object.values(timers.current).flat().forEach(clearTimeout) }, [])

  const push = useCallback((codename: string, accent: string, level: Level, msg: string) => {
    setLog(prev => {
      const next = [...prev, { id: logIdRef.current++, time: clockNow(), codename, accent, level, msg }]
      return next.length > 200 ? next.slice(-200) : next
    })
  }, [])

  const dispatch = useCallback((agent: AgentDef) => {
    // Re-dispatch resets a running agent cleanly.
    ;(timers.current[agent.id] ?? []).forEach(clearTimeout)
    timers.current[agent.id] = []
    setStatus(s => ({ ...s, [agent.id]: "active" }))
    setProgress(p => ({ ...p, [agent.id]: 0 }))
    push(agent.codename, agent.accent, "info", copy.spinup)

    const total = agent.result.line.t
    for (const step of agent.script) {
      timers.current[agent.id].push(setTimeout(() => {
        push(agent.codename, agent.accent, step.level, step.msg)
        setProgress(p => ({ ...p, [agent.id]: Math.min(99, Math.round((step.t / total) * 100)) }))
      }, step.t))
    }
    timers.current[agent.id].push(setTimeout(() => {
      const r = agent.result
      push(agent.codename, agent.accent, r.line.level, r.line.msg)
      setStatus(s => ({ ...s, [agent.id]: r.status }))
      setProgress(p => ({ ...p, [agent.id]: 100 }))
    }, agent.result.line.t))
  }, [push, copy])

  const dispatchAll = useCallback(() => {
    push("SYSTEM", C.blue, "info", copy.sweepMsg(AGENTS.length))
    AGENTS.forEach((a, i) => setTimeout(() => dispatch(a), i * 260))
    // Record the sweep in history. Each agent's outcome is deterministic, so the
    // set of flagged findings this run will produce is known up front.
    const flagged: Flag[] = AGENTS.filter(a => a.result.status === "alert")
      .map(a => ({ name: a.name, codename: a.codename, accent: a.accent, msg: a.result.line.msg }))
    setSweeps(s => [{ id: sweepIdRef.current++, time: clockNow().slice(0, 8), total: AGENTS.length, alerts: flagged }, ...s].slice(0, 10))
  }, [dispatch, push, AGENTS, copy])

  const resetAll = useCallback(() => {
    Object.values(timers.current).flat().forEach(clearTimeout)
    timers.current = {}
    setStatus(Object.fromEntries(AGENTS.map(a => [a.id, "idle" as AgentStatus])))
    setProgress({})
    setLog([{ id: logIdRef.current++, time: clockNow(), codename: "SYSTEM", accent: C.dim, level: "info", msg: "Console cleared — standing by" }])
  }, [AGENTS])

  const activeCount = useMemo(() => Object.values(status).filter(s => s === "active").length, [status])
  const alertCount = useMemo(() => Object.values(status).filter(s => s === "alert").length, [status])
  // The findings currently flagged — what each alert actually is, not just a count.
  const liveAlerts = useMemo<Flag[]>(() =>
    AGENTS.filter(a => status[a.id] === "alert")
      .map(a => ({ name: a.name, codename: a.codename, accent: a.accent, msg: a.result.line.msg })),
    [status, AGENTS])
  const selectedAgent = AGENTS.find(a => a.id === selected)!

  const spaceGrotesk = "font-[family-name:var(--font-space-grotesk)]"
  const mono = "font-[family-name:var(--font-jetbrains-mono)]"

  return (
    <div
      className="min-h-screen w-full"
      style={{ background: C.navy, color: C.text, fontFamily: "var(--font-inter)" }}
    >
      {/* Top command bar */}
      <header
        className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b px-4 py-3 backdrop-blur"
        style={{ borderColor: C.line, background: "rgba(10,15,30,0.82)" }}
      >
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors"
            style={{ borderColor: C.line }}
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="h-4 w-4" style={{ color: C.dim }} />
          </Link>
          <div className="flex items-center gap-2.5">
            <span className="mc-live-dot" style={{ background: activeCount ? C.green : brand }} />
            <div>
              <h1 className={`${spaceGrotesk} text-sm font-bold tracking-wide`} style={{ color: C.bright }}>
                {context.variant === "sbr" ? "SILICON BRICK ROAD" : "ATLAS MISSION CONTROL"}
              </h1>
              <p className={`${mono} text-[10px] tracking-wider`} style={{ color: C.dim }}>
                {copy.subtitle} · {context.label.toUpperCase()}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <StatChip label="ACTIVE" value={String(activeCount)} color={activeCount ? C.green : C.dim} mono={mono} />
          <StatChip label="ALERTS" value={String(alertCount)} color={alertCount ? C.red : C.dim} mono={mono} />
          <span className={`${mono} hidden text-xs tabular-nums sm:inline`} style={{ color: C.dim }}>{clock || "--:--:--"}</span>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 p-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
        {/* ── Left: agent roster ─────────────────────────────────────────── */}
        <aside className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <SectionLabel mono={mono}>{copy.roster}</SectionLabel>
            <span className={`${mono} text-[10px]`} style={{ color: C.dim }}>{AGENTS.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {AGENTS.map(agent => {
              const st = status[agent.id]
              const Icon = agent.icon
              const isSel = selected === agent.id
              return (
                <button
                  key={agent.id}
                  onClick={() => setSelected(agent.id)}
                  onDoubleClick={() => dispatch(agent)}
                  className={`mc-tile group relative flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${st === "active" ? "mc-tile-active" : ""}`}
                  style={{
                    background: isSel ? C.cardHi : C.card,
                    borderColor: st === "active" ? agent.accent : st === "alert" ? C.red : isSel ? agent.accent : C.line,
                  }}
                >
                  <span
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: "rgba(255,255,255,0.04)", color: agent.accent }}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold" style={{ color: C.label }}>{agent.name}</span>
                      <StatusDot status={st} />
                    </span>
                    <span className={`${mono} mt-0.5 block truncate text-[10px] tracking-wide`} style={{ color: C.dim }}>
                      {agent.codename}
                    </span>
                    {st === "active" && (
                      <span className="mt-2 block h-1 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                        <span className="block h-full rounded-full transition-all duration-300" style={{ width: `${progress[agent.id] ?? 0}%`, background: agent.accent }} />
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </aside>

        {/* ── Centre: active mission + execution log ─────────────────────── */}
        <main className="flex min-w-0 flex-col gap-4">
          {/* Active mission card */}
          <section className="rounded-2xl border p-4" style={{ background: C.card, borderColor: C.line }}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: "rgba(255,255,255,0.04)", color: selectedAgent.accent }}>
                  <selectedAgent.icon className="h-5 w-5" />
                </span>
                <div>
                  <h2 className={`${spaceGrotesk} text-lg font-bold`} style={{ color: C.bright }}>{selectedAgent.name}</h2>
                  <p className="text-xs" style={{ color: C.dim }}>{selectedAgent.blurb}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => dispatch(selectedAgent)}
                  className={`${mono} flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all active:scale-95`}
                  style={{ background: selectedAgent.accent, color: C.navy }}
                >
                  <Play className="h-3.5 w-3.5" /> {copy.dispatch}
                </button>
                <button
                  onClick={dispatchAll}
                  className={`${mono} flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-all active:scale-95`}
                  style={{ borderColor: C.line, color: C.gold }}
                >
                  <Zap className="h-3.5 w-3.5" /> {copy.sweep}
                </button>
              </div>
            </div>

            {/* mission telemetry strip */}
            <div className="mt-4 grid grid-cols-3 gap-2">
              <Telemetry mono={mono} label="STATUS" value={status[selected].toUpperCase()} color={statusColor(status[selected])} />
              <Telemetry mono={mono} label="PROGRESS" value={`${progress[selected] ?? 0}%`} color={C.blue} />
              <Telemetry mono={mono} label={copy.codenameLabel} value={selectedAgent.codename} color={C.dim} />
            </div>
          </section>

          {/* Flagged findings — surfaces WHAT each alert is, not just the count */}
          {liveAlerts.length > 0 && (
            <section className="rounded-2xl border p-4" style={{ background: "rgba(224,85,85,0.06)", borderColor: "rgba(224,85,85,0.35)" }}>
              <div className="mb-2.5 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" style={{ color: C.red }} />
                <span className={`${mono} text-[11px] font-semibold tracking-widest`} style={{ color: C.red }}>{copy.flaggedTitle}</span>
                <span className={`${mono} text-[11px]`} style={{ color: C.dim }}>· {liveAlerts.length}</span>
              </div>
              <ul className="space-y-1.5">
                {liveAlerts.map(a => (
                  <li key={a.codename}>
                    <button
                      onClick={() => setSelected(AGENTS.find(x => x.codename === a.codename)?.id ?? selected)}
                      className="flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors hover:brightness-125"
                      style={{ borderColor: C.line, background: "rgba(255,255,255,0.02)" }}
                    >
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: a.accent }} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-semibold" style={{ color: C.label }}>{a.name}</span>
                          <span className={`${mono} shrink-0 text-[10px]`} style={{ color: C.dim }}>{a.codename}</span>
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug" style={{ color: C.text }}>{a.msg}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Execution log — the real-time ops feed */}
          <section className="flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-2xl border" style={{ background: C.terminal, borderColor: C.line }}>
            <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: C.line }}>
              <div className="flex items-center gap-2">
                <Activity className="h-3.5 w-3.5" style={{ color: C.green }} />
                <span className={`${mono} text-[11px] font-semibold tracking-widest`} style={{ color: C.text }}>{copy.log}</span>
              </div>
              <button onClick={resetAll} className={`${mono} flex items-center gap-1 text-[10px] transition-colors hover:opacity-80`} style={{ color: C.dim }}>
                <Square className="h-3 w-3" /> CLEAR
              </button>
            </div>
            <div ref={logScrollRef} className="mc-scan flex-1 overflow-y-auto px-4 py-3">
              <div className={`${mono} space-y-1 text-[12px] leading-relaxed`}>
                {log.map(l => (
                  <div key={l.id} className="flex gap-2.5">
                    <span className="shrink-0 tabular-nums" style={{ color: C.timestamp }}>{l.time}</span>
                    <span className="w-[86px] shrink-0 truncate" style={{ color: l.accent }}>{l.codename}</span>
                    <span className="min-w-0 flex-1" style={{ color: LEVEL_COLOR[l.level] }}>
                      {l.msg}
                    </span>
                  </div>
                ))}
                <div className="flex gap-2.5">
                  <span className="mc-cursor" style={{ color: C.green }}>▊</span>
                </div>
              </div>
            </div>
          </section>
        </main>

        {/* ── Right: portfolio context ──────────────────────────────────── */}
        <aside className="flex flex-col gap-3">
          <SectionLabel mono={mono}>{copy.ctx}</SectionLabel>

          <div className="rounded-2xl border p-4" style={{ background: C.card, borderColor: C.line }}>
            <p className={`${mono} text-[10px] tracking-wider`} style={{ color: C.dim }}>TOTAL VALUE</p>
            <p className={`${spaceGrotesk} mt-1 text-2xl font-bold tabular-nums`} style={{ color: C.bright }}>
              {fmtMoney(context.totalValue, context.currency)}
            </p>
            <div className="mt-1 flex items-center gap-2">
              {context.dayChangePct != null && (
                <span className={`${mono} text-xs font-semibold tabular-nums`} style={{ color: context.dayChangePct >= 0 ? C.green : C.red }}>
                  {context.dayChangePct >= 0 ? "▲" : "▼"} {Math.abs(context.dayChangePct).toFixed(2)}% today
                </span>
              )}
              {!context.live && (
                <span className={`${mono} rounded px-1.5 py-0.5 text-[9px]`} style={{ background: "rgba(201,168,76,0.12)", color: C.gold }}>SAMPLE</span>
              )}
            </div>
          </div>

          <div className="rounded-2xl border p-4" style={{ background: C.card, borderColor: C.line }}>
            <div className="flex items-center justify-between">
              <p className={`${mono} text-[10px] tracking-wider`} style={{ color: C.dim }}>{copy.alloc}</p>
              {context.driftAlerts > 0 && (
                <span className={`${mono} flex items-center gap-1 text-[10px]`} style={{ color: C.gold }}>
                  <CircleDot className="h-3 w-3" /> {copy.driftText(context.driftAlerts)}
                </span>
              )}
            </div>
            {/* stacked allocation bar */}
            <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.05)" }}>
              {context.holdings.map(h => (
                <span key={h.ticker} style={{ width: `${h.pct}%`, background: h.color }} title={`${h.ticker} ${h.pct.toFixed(1)}%`} />
              ))}
            </div>
            <ul className="mt-3 space-y-2">
              {context.holdings.map(h => (
                <li key={h.ticker} className="flex items-center gap-2.5 text-xs">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: h.color }} />
                  <span className={`${mono} w-14 shrink-0 font-semibold`} style={{ color: C.label }}>{h.ticker}</span>
                  <span className="min-w-0 flex-1 truncate" style={{ color: C.dim }}>{h.name}</span>
                  <span className={`${mono} shrink-0 tabular-nums`} style={{ color: C.text }}>{h.pct.toFixed(1)}%</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Cash-buffer card is an Atlas governance concept (2% floor) — SBR has no
              cash buffer (its floor is the SGD 46k capital goal), so hide it there. */}
          {copy.showCash && (
            <div className="rounded-2xl border p-4" style={{ background: C.card, borderColor: C.line }}>
              <p className={`${mono} text-[10px] tracking-wider`} style={{ color: C.dim }}>CASH BUFFER</p>
              <div className="mt-2 flex items-end justify-between">
                <p className={`${spaceGrotesk} text-lg font-bold tabular-nums`} style={{ color: C.green }}>
                  {context.cashPct != null ? `${context.cashPct.toFixed(1)}%` : "—"}
                </p>
                <p className={`${mono} text-[10px]`} style={{ color: C.dim }}>floor 2.0%</p>
              </div>
            </div>
          )}

          {/* Sweep history — a record of each full run and exactly what it flagged */}
          <div className="rounded-2xl border p-4" style={{ background: C.card, borderColor: C.line }}>
            <p className={`${mono} text-[10px] tracking-wider`} style={{ color: C.dim }}>{copy.historyTitle}</p>
            {sweeps.length === 0 ? (
              <p className="mt-2 text-xs" style={{ color: C.dim }}>{copy.noSweeps}</p>
            ) : (
              <ul className="mt-2.5 space-y-3">
                {sweeps.map(sw => (
                  <li key={sw.id}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`${mono} text-[11px] tabular-nums`} style={{ color: C.text }}>{sw.time}</span>
                      <span className={`${mono} text-[10px]`} style={{ color: sw.alerts.length ? C.gold : C.green }}>
                        {sw.total} {copy.unit} · {sw.alerts.length} {copy.flaggedWord}
                      </span>
                    </div>
                    {sw.alerts.length > 0 && (
                      <ul className="mt-1.5 space-y-1 border-l pl-2.5" style={{ borderColor: C.line }}>
                        {sw.alerts.map(a => (
                          <li key={a.codename} className="text-[11px] leading-snug" style={{ color: C.dim }}>
                            <span className="font-semibold" style={{ color: a.accent }}>{a.name}</span> — {a.msg}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

// ── small presentational helpers ────────────────────────────────────────────
function statusColor(s: AgentStatus) {
  return s === "active" ? C.blue : s === "done" ? C.green : s === "alert" ? C.red : C.dim
}

function StatusDot({ status }: { status: AgentStatus }) {
  const color = statusColor(status)
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {status === "active" && <span className="mc-ping absolute inline-flex h-full w-full rounded-full opacity-70" style={{ background: color }} />}
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
    </span>
  )
}

function StatChip({ label, value, color, mono }: { label: string; value: string; color: string; mono: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-lg border px-2 py-1" style={{ borderColor: C.line }}>
      <span className={`${mono} text-[9px] tracking-wider`} style={{ color: C.dim }}>{label}</span>
      <span className={`${mono} text-xs font-bold tabular-nums`} style={{ color }}>{value}</span>
    </span>
  )
}

function SectionLabel({ children, mono }: { children: React.ReactNode; mono: string }) {
  return <p className={`${mono} text-[10px] font-semibold tracking-widest`} style={{ color: C.dim }}>{children}</p>
}

function Telemetry({ label, value, color, mono }: { label: string; value: string; color: string; mono: string }) {
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: C.line, background: "rgba(255,255,255,0.02)" }}>
      <p className={`${mono} text-[9px] tracking-wider`} style={{ color: C.dim }}>{label}</p>
      <p className={`${mono} mt-0.5 truncate text-xs font-bold`} style={{ color }}>{value}</p>
    </div>
  )
}
