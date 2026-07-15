import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { ATLAS_SPEC, SBR_SPEC } from "@/lib/portfolio-spec"
import { formatCurrency } from "@/lib/utils"
import { PiggyBank, Wallet, CalendarClock, Info } from "lucide-react"
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

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}
function monthLabel(y: number, m: number): string {
  return new Date(y, m, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" })
}

async function getContributionData(userId: string, constitutionId: string) {
  const isSbr = constitutionId === "silicon-brick-road"
  const spec = isSbr ? SBR_SPEC : ATLAS_SPEC
  const [records, cashBank, bankEntries] = await Promise.all([
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
  ])

  // Sum recorded contributions per calendar month.
  const byMonth = new Map<string, number>()
  for (const r of records) byMonth.set(monthKey(r.date), (byMonth.get(monthKey(r.date)) ?? 0) + r.amount)

  // Build a continuous month range from the first recorded contribution to the current month.
  const now = new Date()
  const rows: ContributionMonthRow[] = []
  if (records.length > 0) {
    const first = records[0].date
    let y = first.getFullYear()
    let m = first.getMonth()
    const endY = now.getFullYear()
    const endM = now.getMonth()
    while (y < endY || (y === endY && m <= endM)) {
      const key = `${y}-${String(m + 1).padStart(2, "0")}`
      // Planned = the constitution's monthly contribution; Atlas Core adds its January boost.
      const planned = spec.monthlyContribution + (!isSbr && m === 0 ? ATLAS_SPEC.annualJanuaryBoost : 0)
      rows.push({
        key,
        label: monthLabel(y, m),
        contributed: byMonth.get(key) ?? 0,
        planned,
        isCurrentMonth: y === endY && m === endM,
      })
      m++
      if (m > 11) { m = 0; y++ }
    }
    rows.reverse() // newest first
  }

  const totalContributed = records.reduce((s, r) => s + r.amount, 0)
  const thisYear = records.filter((r) => r.date.getFullYear() === now.getFullYear()).reduce((s, r) => s + r.amount, 0)

  return {
    rows: rows.slice(0, MAX_MONTH_ROWS),
    truncated: rows.length > MAX_MONTH_ROWS,
    totalContributed,
    thisYear,
    plannedMonthly: spec.monthlyContribution,
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
            <p className="text-2xl font-black tabular-nums">{formatCurrency(d.plannedMonthly, "SGD")}</p>
            {d.januaryBoost > 0 && (
              <p className="text-[10px] text-muted-foreground mt-0.5">+ {formatCurrency(d.januaryBoost, "SGD")} January boost</p>
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
            {d.truncated && (
              <p className="text-[11px] text-muted-foreground">Showing the most recent {MAX_MONTH_ROWS} months.</p>
            )}
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

        {/* Cash-bank carry-forward history */}
        <CashBankHistory entries={d.bankEntries} bankLabel={`${bankLabel} — recent movements`} />
        <p className="text-[11px] text-muted-foreground">{bankHint}</p>
      </div>
    </Shell>
  )
}
