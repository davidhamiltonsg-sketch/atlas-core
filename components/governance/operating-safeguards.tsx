import { Card, CardHeader } from "@/components/ui/primitives"
import { OPERATING_ASSUMPTIONS as A } from "@/lib/constants"
import { Globe, Wallet, Landmark, Server, KeyRound, Scale } from "lucide-react"

// Operating safeguards — the assumptions and guardrails that keep a 20-year plan robust.
// Added from the v6.7 analyst review (currency, emergency reserve, estate tax, platform,
// overrides, rule-conflict order).
const ITEMS = [
  {
    Icon: Globe, title: "Currency",
    body: `Invested in ${A.baseCurrency}, tracked in ${A.trackingCurrency}. You'll retire spending ${A.retirementCurrency}, so a falling USD costs you a little in local terms — accepted while growing. From 2042 the bond sleeve is partly hedged to ${A.retirementCurrency} as the horizon shortens.`,
  },
  {
    Icon: Wallet, title: "Emergency cash sits outside this portfolio",
    body: `Keep at least ${A.emergencyReserveMonths} months of expenses in the bank, separate from here. That way the SGOV buffer is only ever spent on market opportunities and retirement drawdowns — never on a day-to-day emergency.`,
  },
  {
    Icon: Landmark, title: "US estate-tax exposure",
    body: `US-domiciled ETFs over ~$${A.usEstateTaxTriggerUsd.toLocaleString()} USD expose a non-US person to US estate tax. Above that, move to the Irish-UCITS alternatives (§6B). Your live status is shown in the dashboard Rule Check.`,
  },
  {
    Icon: Server, title: "Platform & custody",
    body: `Held at ${A.broker}. Single-broker exposure is accepted — but review opening a second custodian on a regulatory change, sanctions/capital-control risk, or once the balance is large enough to be a material single point of failure.`,
  },
  {
    Icon: KeyRound, title: "Who can override the rules",
    body: `No one, day-to-day. Overrides are allowed only at the annual January review or a genuine documented emergency — and every override is written down with its reason.`,
  },
  {
    Icon: Scale, title: "When two rules disagree",
    body: `Order of priority: hidden concentration limits (§4) beat drift rules (§3) beat the contribution engine (§5). Hard limits beat soft warnings. When still unclear, the more conservative reading wins — the one that does less and sells nothing. A position losing money never overrides any rule.`,
  },
]

export function OperatingSafeguards() {
  return (
    <Card className="mb-6">
      <CardHeader title="Operating Safeguards" subtitle="The assumptions and guardrails that keep this plan robust over 20 years" />
      <div className="divide-y divide-border">
        {ITEMS.map(({ Icon, title, body }) => (
          <div key={title} className="flex items-start gap-3 px-5 py-3.5">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10">
              <Icon className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
            </span>
            <div>
              <p className="text-xs font-semibold">{title}</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{body}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
