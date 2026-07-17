'use client'

import { ChevronRight, BarChart3, TrendingUp, Settings, RefreshCw } from 'lucide-react'
import Link from 'next/link'

export function GettingStartedGuide() {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-6 mb-6">
      <h2 className="text-sm font-bold mb-4">Quick Navigation Guide</h2>
      <div className="space-y-3 text-sm text-muted-foreground">
        <div className="flex gap-3">
          <BarChart3 className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
          <div className="flex-1">
            <p className="font-medium text-foreground">Start here: Portfolio Overview</p>
            <p className="text-xs mt-0.5">See your current value, compliance status, and today's action at a glance.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <TrendingUp className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
          <div className="flex-1">
            <p className="font-medium text-foreground">Forecast (Portfolio → Forecast)</p>
            <p className="text-xs mt-0.5">Explore your long-term trajectory. Governance rules appear first, then probability scenarios. See "Starting Portfolio" to verify where projections begin.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <RefreshCw className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
          <div className="flex-1">
            <p className="font-medium text-foreground">Update Holdings (Sidebar: Update Portfolio)</p>
            <p className="text-xs mt-0.5">Add this month's contribution, sync prices, run helpers, and execute rebalancing. Your forecast updates automatically after each action.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Settings className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
          <div className="flex-1">
            <p className="font-medium text-foreground">Deep Dives (Portfolio menu)</p>
            <p className="text-xs mt-0.5">Holdings → see positions and trades. Risk → concentration and drawdown. Reports → full look-through of what you own.</p>
          </div>
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-border/50">
        <p className="text-[10px] text-muted-foreground/60 mb-3">TYPICAL WORKFLOW</p>
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-primary text-[10px] font-bold">1</span>
            <span>Check compliance</span>
          </span>
          <ChevronRight className="h-3 w-3" />
          <span className="flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-primary text-[10px] font-bold">2</span>
            <span>Review forecast</span>
          </span>
          <ChevronRight className="h-3 w-3" />
          <span className="flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-primary text-[10px] font-bold">3</span>
            <span>Execute actions</span>
          </span>
        </div>
      </div>
    </div>
  )
}
