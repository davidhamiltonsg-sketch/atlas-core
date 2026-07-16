import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { ATLAS_SPEC, SBR_SPEC } from "@/lib/portfolio-spec"
import { formatCurrency } from "@/lib/utils"
import { money, convert } from "@/lib/money"
import { getCachedUsdSgdRate } from "@/lib/fx-cache"
import { sgtToday, sgtMonthKey, sgtYear } from "@/lib/sgt-date"
import { ibkrCredentialsFor } from "@/lib/ibkr-config"
import { PiggyBank, Wallet, CalendarClock, Info, AlertTriangle } from "lucide-react"
import { ManualEntryPanel } from "@/components/contributions/manual-entry"
import {
  ContributionLedger,
  CashBankHistory,
  type ContributionMonthRow,
  type CashBankEntryRow,
} from "@/components/contributions/contribution-ledger"

// Auth-gated ledger with live "current month" maths; the sync cron revalidates this path
// after each import, so pin it dynamic like the cockpit.
export const dynamic = "force-dynamic"

const MAX_MONTH_ROWS = 24

function monthLabel(y: number, m: number): string {
  return new Date(y, m, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" })
}

async function getContributionData(userId: string, constitutionId: string) {
  const isSbr = constitutionId === "silicon-brick-road"
  const [records, cashBank, bankEntries, owner] = await Promise.all([
    // ContributionRecord is the single contribution ledger: IBKR deposits/withdrawals when the
    // cash report is available, net BUY-minus-SELL otherwise (see lib/holdings-sync.ts).
    db.contributionRecord.findMany({ where: { userId }, orderBy: { date: "asc" } }),
    db.dcaCashBank.findUnique({
      where: { userId_constitutionId_currency: { userId, constitutionId, currency: "SGD" } },
    }),
    db.dcaBankEntry.findMany({
      where: { userId, constitutionId },
      orderBy: { date: "desc" },
      take: 12,
    }),
    db.user.findUnique({ where: { id: userId }, select: { monthlyContribution: true } }),
  ])

  // The plan. Atlas: the owner setting is USD (Art. XIII — US$3,000/month + US$20,000 in
  // January; reporting is SGD), converted once at the declared money boundary so it can be
  // compared with the SGD-settled actuals. SBR: the plan is SGD natively — no conversion.
  const planMonthly = owner?.monthlyContribution ?? (isSbr ? SBR_SPEC.monthlyContribution : ATLAS_SPEC.monthlyContribution)
  const usdSgdRate = isSbr ? 1 : await getCachedUsdSgdRate()
  const planToSgd = (amount: number) => (isSbr ? amount : convert(money(amount, "USD"), "SGD", usdSgdRate).amount)

  // Sum recorded contributions per Singapore calendar month (DB timestamps are UTC — a
  // deposit at 07:00 SGT on the 1st must not be bucketed into the previous month).
  const byMonth = new Map<string, number>()
  for (const r of records) byMonth.set(sgtMonthKey(r.date), (byMonth.get(sgtMonthKey(r.date)) ?? 0) + r.amount)

  // Build a continuous month range from the first recorded contribution to the current month.
  const now = sgtToday()
  const rows: ContributionMonthRow[] = []
  if (records.length > 0) {
    const firstKey = sgtMonthKey(records[0].date)
    let y = Number(firstKey.slice(0, 4))
    let m = Number(firstKey.slice(5)) - 1
    const endY = now.y
    const endM = now.m
    while (y < endY || (y === endY && m <= endM)) {
      const key = `${y}-${String(m + 1).padStart(2, "0")}`
      // Planned = the owner's monthly plan; Atlas Core adds its January boost. USD plan
      // figures are converted at today's live rate (noted under the table).
      const plannedPlanCcy = planMonthly + (!isSbr && m === 0 ? ATLAS_SPEC.annualJanuaryBoost : 0)
      const planned = planToSgd(plannedPlanCcy)
      rows.push({
        key,
        label: monthLabel(y, m),
        contributed: byMonth.get(key) ?? 0,
        planned,
        plannedDisplay: isSbr ? undefined : `${formatCurrency(plannedPlanCcy, "USD")} ≈ ${formatCurrency(planned, "SGD")}`,
        isCurrentMonth: y === endY && m === endM,
      })
      m++
      if (m > 11) { m = 0; y++ }
    }
    rows.reverse() // newest first
  }

  const totalContributed = records.reduce((s, r) => s + r.amount, 0)
  const thisYear = records.filter((r) => sgtYear(r.date) === now.y).reduce((s, r) => s + r.amount, 0)

  return {
    rows: rows.slice(0, MAX_MONTH_ROWS),
    truncated: rows.length > MAX_MONTH_ROWS,
    totalContributed,
    thisYear,
    isSbr,
    planMonthly,
    planMonthlySgd: planToSgd(planMonthly),
    usdSgdRate,
    januaryBoost: isSbr ? 0 : ATLAS_SPEC.annualJanuaryBoost,
    cashBankBalance: cashBank?.balance ?? 0,
    bankEntries: bankEntries.map<CashBankEntryRow>((e) => ({
      id: e.id,
      date: e.date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }),
      type: e.type,
      description: e.description,
      amount: e.amount,
      balanceAfter: e.balanceAfter,
    })),
    hasRecords: records.length > 0,
  }
}

export default async function ContributionsPage() {
  const session = await getSession()
  if (!session) redirect("/login")
  const active = await activePortfolioContext(session)
  const isSbr = active.constitutionId === "silicon-brick-road"
  const d = await getContributionData(active.owner.id, active.constitutionId)

  // The ledger self-fills ONLY from the IBKR activity feed (deposits, trades,
  // dividends). Holdings values move through other paths, so when the feed is
  // missing this page must say so instead of sitting silently empty.
  const creds = ibkrCredentialsFor(active.constitutionId)
  const activityConfigured = Boolean(creds.token && creds.activityQuery)
  const canMutate = session.role === "admin" || session.userId === active.owner.id
  const holdingTickers = canMutate
    ? (await db.holding.findMany({ where: { userId: active.owner.id }, select: { ticker: true }, orderBy: { ticker: "asc" } })).map((h) => h.ticker)
    : []

  // Plain-English copy for the SBR surface; Atlas keeps the constitution vocabulary.
  const bankLabel = isSbr ? "Cash waiting for the next purchase" : "DCA cash bank"
  const bankHint = isSbr
    ? "Money that could not buy a whole share yet. It carries forward and is used first next month."
    : "Contribution cash carried forward until it can fund the next whole-share purchase."

  return (
    <Shell
      title={isSbr ? "Money You've Added" : "Contribution Ledger"}
      subtitle={isSbr ? "Silicon Brick Road — what went in, month by month" : "Atlas Core — contributed versus planned, month by month"}
      userName={session.name}
      isAdmin={session.role === "admin"}
      constitutionId={active.constitutionId}
    >
      <div className="space-y-5">

        {/* Activity feed not connected — the reason this page would otherwise stay empty */}
        {!activityConfigured && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-5 flex gap-3">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold">No broker activity feed is connected for this portfolio</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Holdings values still update, but contributions and dividends only fill automatically from an
                IBKR <span className="font-semibold">Activity</span> Flex query (Trades + Cash Transactions + Dividends).
                {isSbr
                  ? " Set IBKR_SBR_FLEX_TOKEN and IBKR_SBR_FLEX_QUERY_ID_ACTIVITY, then run Import Activity from IBKR."
                  : " Set IBKR_FLEX_TOKEN and IBKR_FLEX_QUERY_ID_ACTIVITY (from the owner's own IBKR account), then run Import Activity from IBKR."}
                {" "}Until then, use the manual entry below.
              </p>
            </div>
          </div>
        )}

        {/* Summary tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border bg-card p-4 card-elevated">
            <div className="flex items-center gap-2 mb-2">
              <PiggyBank className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{isSbr ? "Added this year" : "Contributed this year"}</p>
            </div>
            <p className="text-2xl font-black tabular-nums">{formatCurrency(d.thisYear, "SGD")}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 card-elevated">
            <div className="flex items-center gap-2 mb-2">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Monthly plan</p>
            </div>
            {/* Atlas plan is USD (Art. XIII); the SGD equivalent uses today's live rate. */}
            <p className="text-2xl font-black tabular-nums">{formatCurrency(d.planMonthly, isSbr ? "SGD" : "USD")}</p>
            {!isSbr && (
              <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">≈ {formatCurrency(d.planMonthlySgd, "SGD")} at {d.usdSgdRate.toFixed(4)}</p>
            )}
            {d.januaryBoost > 0 && (
              <p className="text-[10px] text-muted-foreground mt-0.5">+ {formatCurrency(d.januaryBoost, "USD")} January boost</p>
            )}
          </div>
          <div className="rounded-xl border border-border bg-card p-4 card-elevated">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{bankLabel}</p>
            </div>
            <p className="text-2xl font-black tabular-nums">{formatCurrency(d.cashBankBalance, "SGD")}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 card-elevated">
            <div className="flex items-center gap-2 mb-2">
              <PiggyBank className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{isSbr ? "Added all time" : "Contributed all time"}</p>
            </div>
            <p className="text-2xl font-black tabular-nums">{formatCurrency(d.totalContributed, "SGD")}</p>
          </div>
        </div>

        {/* Month-by-month ledger */}
        {d.hasRecords ? (
          <>
            <ContributionLedger rows={d.rows} />
            <p className="text-[11px] text-muted-foreground">
              {d.truncated ? `Showing the most recent ${MAX_MONTH_ROWS} months. ` : ""}
              {!isSbr && `Planned amounts are the US$ plan converted at today's rate (${d.usdSgdRate.toFixed(4)}); amounts added are the SGD-settled figures from the broker.`}
            </p>
          </>
        ) : (
          <div className="rounded-xl border border-border bg-card p-5 flex gap-3">
            <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold">No contributions recorded yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isSbr
                  ? "Once the app receives a deposit or a purchase from the broker, each month's money in will appear here automatically."
                  : "Deposits and purchases imported from IBKR appear here automatically after the next activity sync."}
              </p>
            </div>
          </div>
        )}

        {/* Owner-only manual fallback — tagged [manual], append-only */}
        {canMutate && <ManualEntryPanel tickers={holdingTickers} />}

        {/* Cash-bank carry-forward history */}
        <CashBankHistory entries={d.bankEntries} bankLabel={`${bankLabel} — recent movements`} />
        <p className="text-[11px] text-muted-foreground">{bankHint}</p>
      </div>
    </Shell>
  )
}
