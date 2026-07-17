'use client'

import { AlertCircle, LineChart, CheckCircle2 } from 'lucide-react'

export function ForecastGuide() {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-5 mb-6">
      <h2 className="text-sm font-bold mb-3">Understanding Your Forecast</h2>
      <div className="space-y-2.5 text-sm text-muted-foreground">
        <div className="flex gap-2.5">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-green-500" />
          <div>
            <p className="font-medium text-foreground">1. Check Compliance First</p>
            <p className="text-xs">The governance dashboard at the top shows your current compliance status. Make sure all rules are satisfied before reviewing projections.</p>
          </div>
        </div>
        <div className="flex gap-2.5">
          <LineChart className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
          <div>
            <p className="font-medium text-foreground">2. Verify Your Starting Point</p>
            <p className="text-xs">The "Starting Portfolio Value" card shows where your projections begin. Use "Update holdings" if prices are stale, or "View portfolio" to verify current positions.</p>
          </div>
        </div>
        <div className="flex gap-2.5">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
          <div>
            <p className="font-medium text-foreground">3. Explore Scenarios</p>
            <p className="text-xs">Review Conservative, Base, and Aggressive scenarios. These show ranges based on historical volatility, not predictions. Your actual outcome will likely fall somewhere in between.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
