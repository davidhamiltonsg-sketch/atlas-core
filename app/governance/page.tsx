import { Shell } from "@/components/shell"
import { ShieldCheck, Plus } from "lucide-react"

const ruleCategories = [
  {
    category: "Allocation Rules",
    rules: [
      { title: "SMH Hard Cap", desc: "SMH must not exceed 15% of total portfolio value.", active: true },
      { title: "BTC Hard Cap", desc: "BTC must not exceed 5% of total portfolio value.", active: true },
      { title: "QQQM Target Band", desc: "QQQM target 22.5% ± 2.5% tolerance band.", active: true },
    ],
  },
  {
    category: "Drift & Rebalancing",
    rules: [
      { title: "Drift Review Trigger", desc: "Review portfolio when any holding drifts >5% from target.", active: true },
      { title: "Contribution Routing", desc: "Direct new contributions to underweight positions first.", active: true },
      { title: "No Panic Selling", desc: "No sells during drawdowns >20% without 48h cooling-off period.", active: true },
    ],
  },
  {
    category: "Behavioural Guards",
    rules: [
      { title: "Redesign Moratorium", desc: "No structural portfolio changes within 90 days of the last change.", active: false },
      { title: "Market Timing Ban", desc: "No tactical allocation shifts based on macro predictions.", active: true },
    ],
  },
]

export default function Governance() {
  return (
    <Shell
      title="Governance Engine"
      subtitle="Rules, thresholds, and disciplined execution"
    >
      <div className="flex justify-end mb-4">
        <button className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 transition-opacity">
          <Plus className="h-3 w-3" />
          Add Rule
        </button>
      </div>

      <div className="space-y-6">
        {ruleCategories.map(({ category, rules }) => (
          <div key={category}>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              {category}
            </h2>
            <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
              {rules.map(({ title, desc, active }) => (
                <div
                  key={title}
                  className="flex items-start justify-between gap-4 px-5 py-4"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                        active ? "bg-green-500/15" : "bg-muted"
                      }`}
                    >
                      <ShieldCheck
                        className={`h-3 w-3 ${active ? "text-green-500" : "text-muted-foreground"}`}
                      />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{desc}</p>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      active
                        ? "bg-green-500/10 text-green-500"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {active ? "Active" : "Inactive"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  )
}
