"use client"

import { useState } from "react"
import {
  ChevronDown, ShieldCheck, Globe, Zap, Cpu, Earth, Bitcoin, Layers, Scale, CheckCircle2, Circle,
  type LucideIcon,
} from "lucide-react"

interface Rule {
  id: string
  title: string
  description: string
  active: boolean
  category: string
}

interface CollapsibleRuleGroupProps {
  category: string
  rules: Rule[]
  defaultOpen?: boolean
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "VT Governance":           Globe,
  "QQQM Governance":         Zap,
  "SMH Governance":          Cpu,
  "VWO Governance":          Earth,
  "BTC Governance":          Bitcoin,
  "Bitcoin Governance (BTC + IBIT)": Bitcoin,
  "Overlap & Concentration": Layers,
  "Rebalancing":             Scale,
  "Behavioural Guards":      ShieldCheck,
  "Compliance":              CheckCircle2,
}

export function CollapsibleRuleGroup({ category, rules, defaultOpen = false }: CollapsibleRuleGroupProps) {
  const [open, setOpen] = useState(defaultOpen)
  const activeCount = rules.filter((r) => r.active).length

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-accent/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          {(() => { const Icon = CATEGORY_ICONS[category] ?? Circle; return <Icon className="h-4 w-4 text-violet-400 shrink-0" aria-hidden /> })()}
          <div>
            <p className="text-sm font-semibold">{category}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {activeCount} of {rules.length} rule{rules.length !== 1 ? "s" : ""} active
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Active pill */}
          <span className="rounded-full bg-green-500/10 text-green-500 text-[10px] font-semibold px-2 py-0.5 ring-1 ring-green-500/20">
            {activeCount} active
          </span>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {/* Expandable rules */}
      {open && (
        <div className="divide-y divide-border border-t border-border">
          {rules.map(({ id, title, description, active }) => (
            <div key={id} className="flex items-start gap-3 px-5 py-4">
              <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${active ? "bg-green-500/15" : "bg-muted"}`}>
                <ShieldCheck className={`h-3 w-3 ${active ? "text-green-500" : "text-muted-foreground"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{title}</p>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{description}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${active ? "bg-green-500/10 text-green-500" : "bg-muted text-muted-foreground"}`}>
                {active ? "Active" : "Off"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
