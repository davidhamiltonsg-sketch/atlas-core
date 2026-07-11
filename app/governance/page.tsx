import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { ShieldCheck, AlertTriangle, CheckCircle2, XCircle, FileText, Zap } from "lucide-react"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { CollapsibleRuleGroup } from "@/components/governance/collapsible-rule-group"
import { FloatingCapsSection } from "@/components/governance/floating-caps-section"
import { PreCommitments } from "@/components/governance/pre-commitments"
import { OperatingSafeguards } from "@/components/governance/operating-safeguards"
import { GOVERNANCE_BAND_ROWS } from "@/lib/constants"
import { displayTicker } from "@/lib/approved-alternatives"
import { constitutionIdForEmail } from "@/lib/constitutions"
import { SbrConstitution } from "@/components/sbr/sbr-constitution"
import { ThresholdGauge } from "@/components/governance/threshold-gauge"

// §2/§3 gauge rows are DERIVED from lib/constants (TICKER_TARGETS + HARD_THRESHOLDS +
// POSITION_PROFILE) — the single source of truth, so they can never drift from the engine.
const thresholds = GOVERNANCE_BAND_ROWS

const monthlySteps = [
  {
    step: 1,
    question: "Is anything over its safety limit?",
    detail: "Look at each holding's percentage in the dashboard. Has anything crossed into the red zone?",
    yes: "Act before investing new money. SEMI over 12% → sell some back to 10%. BTC+IBIT over 8% → stop buying. EQQQ over 30% → sell some back. Nvidia over 13% of total portfolio → reduce chip exposure. Then go to Step 6.",
    no: "Nothing is over its limit. Move to Step 2.",
  },
  {
    step: 2,
    question: "Is anything too small?",
    detail: "Has any holding fallen below where it should be?",
    yes: "Put 100% of this month's money into the holding that is furthest below its target. Don't split it between multiple funds — one fund gets it all. Then go to Step 6.",
    no: "Everything is at or above target. Move to Step 3.",
  },
  {
    step: 3,
    question: "Is anything drifting too high — but not yet at the hard limit?",
    detail: "This is the amber zone: above the comfortable range but not yet requiring a forced sale.",
    yes: "Stop buying that holding for now. Send new money to the underweights instead. Don't sell anything yet — just redirect. Then go to Step 6.",
    no: "Nothing is drifting. Move to Step 4.",
  },
  {
    step: 4,
    question: "Is there a hidden exposure warning?",
    detail: "Your funds overlap — you can hold too much of one company or sector without realising it. Check the Floating Caps section below. Has any hidden exposure crossed its warning level? (e.g. semiconductors above 16%, Nvidia above 10%)",
    yes: "Schedule a review within 30 days. Keep investing normally while you wait. Don't change your holdings during the review. Then go to Step 6.",
    no: "No hidden exposure warnings. Move to Step 5.",
  },
  {
    step: 5,
    question: "Everything looks fine — invest as normal.",
    detail: "No limits breached, nothing too small or too large, no hidden exposure warnings active.",
    yes: null,
    no: null,
    action: "Split this month's contribution at target weights: VWRA 52% · EQQQ 23% · SEMI 10% · VFEA 8% · Bitcoin sleeve 7% (via IBIT). Then go to Step 6.",
  },
  {
    step: 6,
    question: "Is the whole portfolio down more than 25% from its highest ever value?",
    detail: "Compare the current total to the all-time high shown in the portfolio history chart.",
    yes: "Markets are crashing. Keep investing the same amount every month — don't panic, don't stop, don't sell. Don't change the portfolio while it's down. This is normal and temporary.",
    no: "All good. You're done for this month.",
  },
  {
    step: 7,
    question: "Quick final checklist.",
    detail: null,
    yes: null,
    no: null,
    action: "Tick off: no work trading restrictions apply · bought after the 15th of the month · normal monthly amount invested · checked all the holdings above.",
  },
  {
    step: 8,
    question: "Close and step away.",
    detail: null,
    yes: null,
    no: null,
    action: "Done. Don't check prices every day. Don't listen to market commentators or financial news. Don't change anything until next month's check. Come back here on the 15th next month.",
  },
]

async function getRules() {
  const rules = await db.governanceRule.findMany({ orderBy: [{ category: "asc" }, { createdAt: "asc" }] })
  const grouped: Record<string, typeof rules> = {}
  for (const rule of rules) {
    if (!grouped[rule.category]) grouped[rule.category] = []
    grouped[rule.category].push(rule)
  }
  return grouped
}

async function getLiveAllocations(userId: string) {
  const holdings = await db.holding.findMany({
    where: { userId },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })
  const totalValue = holdings.reduce((sum, h) => sum + (h.snapshots[0]?.value ?? 0), 0)
  const allocMap: Record<string, number> = {}
  const liveHoldings = holdings.map((h) => {
    const value = h.snapshots[0]?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    allocMap[h.ticker] = actualPct
    return {
      ticker: h.ticker, name: h.name, color: h.color,
      targetPct: h.targetPct, hardCapPct: h.hardCapPct, toleranceBand: h.toleranceBand,
      actualPct, units: h.snapshots[0]?.units ?? 0,
    }
  })
  return { allocMap, liveHoldings }
}

export default async function Governance() {
  const session = await getSession()
  if (!session) redirect("/login")

  // Dami sees the Silicon Brick Road constitution instead of the Atlas Core governance engine.
  if (constitutionIdForEmail(session.email) === "silicon-brick-road") {
    const { allocMap } = await getLiveAllocations(session.userId)
    return <SbrConstitution name={session.name} isAdmin={session.role === "admin"} allocMap={allocMap} />
  }

  const [grouped, { allocMap, liveHoldings }] = await Promise.all([getRules(), getLiveAllocations(session.userId)])
  const totalRules = Object.values(grouped).flat().length
  const activeRules = Object.values(grouped).flat().filter((r) => r.active).length

  // Show a gauge for every holding: the curated core rows + any extra ticker you hold
  // (e.g. IBIT) with bands synthesised from its own target / cap, so new tickers populate here.
  // Bitcoin sleeve: BTC and IBIT are ONE position (7% target / 8% cap). Show a single combined
  // gauge (BTC + IBIT) and fold IBIT's weight into it — never two separate Bitcoin gauges.
  allocMap["BTC + IBIT"] = (allocMap["BTC"] ?? 0) + (allocMap["IBIT"] ?? 0)

  const coreTickers = new Set([...thresholds.map((t) => t.ticker), "IBIT"])
  const extraGauges = liveHoldings
    .filter((h) => !coreTickers.has(h.ticker) && (h.actualPct > 0 || h.units > 0 || h.targetPct > 0))
    .map((h) => {
      const band = h.toleranceBand || 2.5
      const hardHigh = h.hardCapPct ?? (h.targetPct > 0 ? Math.round(h.targetPct * 1.5) : Math.max(Math.ceil(h.actualPct * 1.3), 5))
      return {
        ticker: h.ticker, target: h.targetPct, classification: h.name,
        healthyLow: Math.max(0, h.targetPct - band), healthyHigh: h.targetPct + band,
        softLow: Math.max(0, h.targetPct - band), softHigh: h.targetPct + band,
        hardHigh, hardLow: 0, color: h.color,
      }
    })
  const gaugeRows = [...thresholds, ...extraGauges].map((t) =>
    t.ticker === "BTC"
      ? { ...t, ticker: "BTC + IBIT", classification: "Bitcoin Sleeve — 7% target, 8% cap" }
      : t
  )

  return (
    <Shell title="Governance Engine" subtitle="Rules, thresholds, and disciplined execution — Constitution v1.5" userName={session.name} isAdmin={session.role === "admin"}>

      {/* Full constitution document */}
      <a href="/atlas-core-constitution.html" target="_blank" rel="noopener noreferrer"
        className="rounded-xl border border-violet-500/40 bg-gradient-to-r from-violet-500/[0.08] to-violet-500/[0.06] p-4 mb-4 flex items-center gap-3 hover:from-violet-500/[0.12] transition-colors group">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 shrink-0">
          <FileText className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1">
          <p className="text-xs font-bold text-violet-400">Full Constitution (v1.5)</p>
          <p className="text-xs text-muted-foreground">The complete constitution — all caps, bands, look-through limits, pre-committed shock responses, doctrine (Book V), the registers, and the 2040–2045 glide path.</p>
        </div>
        <span className="text-xs font-semibold text-violet-400 group-hover:text-violet-300 shrink-0">Open ↗</span>
      </a>

      {/* Command Centre callout */}
      <div className="rounded-xl border border-violet-500/30 bg-violet-500/[0.05] p-4 mb-6 flex items-start gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 shrink-0">
          <Zap className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1">
          <p className="text-xs font-bold text-violet-400 mb-0.5">v1.5 — Bitcoin via IBIT · monthly check-in system · live data</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Core holdings are bought when they dip and only sold if something fundamental breaks — never just because they&apos;re down. BTC and IBIT count as one Bitcoin position (7% target, 8% max), with older BTC units gradually swapping into IBIT. The SGOV cash buffer grows from new contributions only — no selling to fund it. Every page ends with one clear instruction: what to do, why you&apos;re doing it, and when.
          </p>
          <a href="/command-centre" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-violet-400 hover:text-violet-300 transition-colors">
            Go to Command Centre →
          </a>
        </div>
      </div>

      {/* What this is */}
      <div className="rounded-xl border border-border bg-card p-5 mb-4">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">What this is</p>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl mb-4">
          This is a retirement portfolio running from 2026 to 2045. Its job is to grow wealth by following a fixed set of rules — not feelings, not headlines, and not random ideas from the internet.
          The rules were written when things were calm. They exist so they can be followed when things are not calm. That is the whole point of having a governance document.
        </p>
        <div className="border-t border-border pt-4">
          <p className="text-[11px] font-semibold text-muted-foreground mb-2">The big rule</p>
          <p className="text-xs text-foreground/80 font-medium">
            Feelings do not get a vote. Fear does not get a vote. Excitement does not get a vote. Headlines do not get a vote.
          </p>
        </div>
      </div>

      {/* What you own and why */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-4">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">What the portfolio owns</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Six positions. Each one has a specific job.</p>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[440px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">Fund</th>
              <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">Target</th>
              <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">Job</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[
              { ticker: "VWRA", target: "52%", job: "The big foundation — owns stocks from all over the world.", color: "#6366f1" },
              { ticker: "EQQQ", target: "23%", job: "The growth engine — the 100 biggest US tech companies.", color: "#8b5cf6" },
              { ticker: "SEMI", target: "10%", job: "The chip bet — semiconductor companies tied to AI and computing.", color: "#a78bfa" },
              { ticker: "VFEA", target: "8%",  job: "The geography balancer — extra exposure to emerging market economies.", color: "#c4b5fd" },
              { ticker: "BTC",  target: "7%",  job: "The wild card — high upside, but kept deliberately small to limit damage if it falls.", color: "#f59e0b" },
              { ticker: "SGOV", target: "buffer", job: "The safety buffer — short-term US government bonds, used as dry powder and a hedge.", color: "#6b7280" },
            ].map(({ ticker, target, job, color }) => (
              <tr key={ticker} className="hover:bg-accent/20">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="font-bold">{ticker}</span>
                  </div>
                </td>
                <td className="px-5 py-3 font-semibold tabular-nums text-muted-foreground">{target}</td>
                <td className="px-5 py-3 text-muted-foreground leading-relaxed">{job}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div className="px-5 py-3 border-t border-border bg-muted/20">
          <p className="text-[11px] text-muted-foreground">
            Plain English: VWRA is the chassis, EQQQ and SEMI are the turbochargers, VFEA adds geographic balance, BTC is the small optional rocket, and SGOV is the spare fuel can. Strong belief in each one is allowed — an oversized bet in any one is not.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="rounded-xl border border-border bg-card p-4 card-elevated flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Total Rules</span>
            <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <p className="text-2xl font-black tabular-nums">{totalRules}</p>
          <p className="text-[11px] text-muted-foreground">Governance framework</p>
        </div>
        <div className="rounded-xl border border-green-500/20 bg-card p-4 card-elevated flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Active</span>
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          </div>
          <p className="text-2xl font-black tabular-nums text-green-500">{activeRules}</p>
          <p className="text-[11px] text-muted-foreground">Rules enforced</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 card-elevated flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Inactive</span>
            <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <p className="text-2xl font-black tabular-nums text-muted-foreground">{totalRules - activeRules}</p>
          <p className="text-[11px] text-muted-foreground">Not enforced</p>
        </div>
      </div>

      {/* Live position gauges */}
      <div className="rounded-xl card-lux overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Where Each Fund Stands Right Now</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Your current percentage vs the comfortable range (green), the warning zone (amber), and the hard limit (red)
          </p>
        </div>
        <ThresholdGauge rows={gaugeRows} allocMap={allocMap} />
      </div>

      {/* Floating governance caps (§4) — replaces the static threshold table in v6.1 */}
      <FloatingCapsSection />

      {/* Behavioural pre-commitments (decided in advance) */}
      <PreCommitments />

      {/* Operating safeguards (currency, emergency reserve, estate tax, platform, overrides) */}
      <OperatingSafeguards />

      {/* Response protocol */}
      <div className="grid gap-3 sm:grid-cols-3 mb-6">
        {[
          {
            label: "On track",
            sub: "Nothing to do",
            text: "Everything is within its target range. Keep investing your normal amount each month.",
            icon: CheckCircle2,
            color: "text-green-500",
            border: "border-green-500/20",
            bg: "bg-green-500/[0.06]",
            pill: "bg-green-500/10 text-green-600 dark:text-green-400",
          },
          {
            label: "Drifting",
            sub: "Send new money elsewhere",
            text: "A holding is starting to drift. Point the next 2–3 months of contributions at the holdings that are too small. No selling needed.",
            icon: AlertTriangle,
            color: "text-amber-500",
            border: "border-amber-500/20",
            bg: "bg-amber-500/[0.06]",
            pill: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          },
          {
            label: "Over the limit",
            sub: "Time to act",
            text: "A holding has passed its hard limit. Stop buying it and sell a little to bring it back to the target. Do this before your next monthly contribution.",
            icon: XCircle,
            color: "text-red-500",
            border: "border-red-500/20",
            bg: "bg-red-500/[0.06]",
            pill: "bg-red-500/10 text-red-600 dark:text-red-400",
          },
        ].map(({ label, sub, text, icon: Icon, color, border, bg, pill }) => (
          <div key={label} className={`rounded-xl border ${border} ${bg} p-4`}>
            <div className="flex items-center gap-2 mb-3">
              <Icon className={`h-4 w-4 ${color}`} />
              <div>
                <p className="text-xs font-bold leading-none">{label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{text}</p>
          </div>
        ))}
      </div>

      {/* Monthly Decision Engine — §5.4 */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Your Monthly 5-Minute Check</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Run this each month before you invest. No predicting, no opinions — just follow the steps in order.
          </p>
        </div>
        <div className="divide-y divide-border">
          {monthlySteps.map((s) => (
            <div key={s.step} className="px-5 py-4 flex gap-4">
              <div className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-black text-muted-foreground mt-0.5">
                {s.step}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground mb-0.5">{s.question}</p>
                {s.detail && <p className="text-[11px] text-muted-foreground mb-2">{s.detail}</p>}
                {s.action ? (
                  <p className="text-[11px] text-foreground/80 bg-muted/40 rounded-lg px-3 py-2 leading-relaxed">{s.action}</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <div className="rounded-lg bg-green-500/[0.06] border border-green-500/15 px-3 py-2">
                      <p className="text-[10px] font-bold text-green-500 mb-0.5">If Yes</p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{s.yes}</p>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-border px-3 py-2">
                      <p className="text-[10px] font-bold text-muted-foreground mb-0.5">If No</p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{s.no}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-border bg-muted/20">
          <p className="text-[11px] text-muted-foreground italic">
            Priority order: hidden exposure checks come first → then drift checks → then the contribution plan.
            If anything is over its hard limit, that always overrides everything else. A safety limit breach is never ignored.
          </p>
        </div>
      </div>

      {/* When can the rules change? */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">When are the rules allowed to change?</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            The rules can only change for serious reasons. The bar is deliberately high.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border">
          <div className="px-5 py-4">
            <p className="text-[11px] font-bold text-green-500 uppercase tracking-wider mb-3">Valid reasons</p>
            <ul className="space-y-2">
              {[
                "A major life change (marriage, dependants, health)",
                "A meaningful change to the retirement timeline",
                "A large, lasting income change",
                "A legal or compliance reason (work restrictions, tax law)",
                "Strong new evidence that the current approach is structurally wrong",
              ].map((r) => (
                <li key={r} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-green-500 mt-1.5" />
                  {r}
                </li>
              ))}
            </ul>
          </div>
          <div className="px-5 py-4">
            <p className="text-[11px] font-bold text-red-500 uppercase tracking-wider mb-3">Not valid reasons</p>
            <ul className="space-y-2">
              {[
                "A market crash (that is precisely when you should not change)",
                "Boredom or wanting something new",
                "A persuasive chart or post on social media",
                "A shiny new idea that hasn't been tested against the rules",
                "Someone else's portfolio doing better right now",
              ].map((r) => (
                <li key={r} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-red-500 mt-1.5" />
                  {r}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-border bg-muted/20">
          <p className="text-[11px] text-muted-foreground">
            Any proposed change must be written down and waited on for at least 7 days. No changes during a market downturn. <span className="font-medium text-foreground">&ldquo;I saw a cool chart online&rdquo; is not a constitutional event.</span>
          </p>
        </div>
      </div>

      {/* Rules by category — collapsible */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Governance Rules
        </h2>
        <span className="text-[11px] text-muted-foreground">Click a category to expand</span>
      </div>
      <div className="space-y-2">
        {Object.entries(grouped).map(([category, rules], i) => (
          <CollapsibleRuleGroup
            key={category}
            category={category}
            rules={rules}
            defaultOpen={i === 0}
          />
        ))}
      </div>
    </Shell>
  )
}
