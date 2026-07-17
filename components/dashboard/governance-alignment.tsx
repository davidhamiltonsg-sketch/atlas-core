import { CheckCircle2, AlertTriangle, XCircle, ShieldCheck } from "lucide-react"
import type { GovAlignment } from "@/lib/governance-status"

// Dashboard panel: are you inside your own rules? One glance, plain English.
export function GovernanceAlignment({ data }: { data: GovAlignment }) {
  const headline =
    data.overall === "ok" ? "You're following all your rules"
    : data.overall === "watch" ? `${data.watches} thing${data.watches > 1 ? "s" : ""} to keep an eye on`
    : `${data.breaches} rule${data.breaches > 1 ? "s" : ""} need${data.breaches > 1 ? "" : "s"} action`

  const headCls =
    data.overall === "ok" ? "text-green-600 dark:text-green-400"
    : data.overall === "watch" ? "text-amber-600 dark:text-amber-400"
    : "text-red-600 dark:text-red-400"

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <div className="flex-1">
          <h2 className="text-sm font-semibold">Rule Check</h2>
          <p className="text-[11px] text-muted-foreground">Is your portfolio following your own rules right now?</p>
        </div>
        <span className={`text-xs font-bold ${headCls}`}>{headline}</span>
      </div>
      <ul className="divide-y divide-border">
        {data.checks.map((c) => {
          const Icon = c.status === "ok" ? CheckCircle2 : c.status === "watch" ? AlertTriangle : XCircle
          const cls = c.status === "ok" ? "text-green-500" : c.status === "watch" ? "text-amber-500" : "text-red-500"
          return (
            <li key={c.id} className="flex items-start gap-3 px-5 py-2.5">
              <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${cls}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold">{c.label}</p>
                <p className="text-[11px] text-muted-foreground">{c.detail}</p>
              </div>
            </li>
          )
        })}
      </ul>
      <div className="px-5 py-2.5 border-t border-border bg-muted/20">
        <a href="/compliance" className="text-[11px] font-semibold text-primary hover:underline">See the full rulebook →</a>
      </div>
    </div>
  )
}
