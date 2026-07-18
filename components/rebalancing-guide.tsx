'use client'

import { BarChart3, AlertCircle, CheckCircle2 } from 'lucide-react'

interface RebalancingGuideProps {
  portfolio: 'atlas-core' | 'silicon-brick-road'
  currentDrift?: { ticker: string; drift: number }[]
}

export function RebalancingGuide({ portfolio, currentDrift }: RebalancingGuideProps) {
  const isAtlas = portfolio === 'atlas-core'

  const steps = isAtlas ? [
    {
      number: 1,
      title: 'Check drift',
      description: 'Compare actual percentages to target weights in Mission Control',
      icon: BarChart3,
    },
    {
      number: 2,
      title: 'Wait for contributions',
      description: 'Route your monthly DCA to underweight positions instead of rebalancing',
      icon: CheckCircle2,
    },
    {
      number: 3,
      title: 'Only sell if necessary',
      description: "Rebalance via sales only if a position exceeds its hard cap/floor — soft bands vary per fund, see Mission Control",
      icon: AlertCircle,
    },
  ] : [
    {
      number: 1,
      title: 'Check fund allocation',
      description: "Review each fund's actual vs target percentage in your holdings",
      icon: BarChart3,
    },
    {
      number: 2,
      title: 'Route new contributions',
      description: 'Direct your monthly savings toward underweight funds to rebalance passively',
      icon: CheckCircle2,
    },
    {
      number: 3,
      title: 'Rebalance occasionally',
      description: 'If a fund drifts outside its soft band or breaches its hard cap, adjust at the next contribution window — see your holdings for exact bands',
      icon: AlertCircle,
    },
  ]

  return (
    <div className="rounded-xl border border-border bg-card/50 p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="h-4 w-4 text-primary" />
        <h3 className="font-bold text-sm">How to Rebalance</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
        {isAtlas
          ? 'Rebalancing maintains your target allocation. The best approach is passive: direct new contributions to underweight positions rather than selling winners.'
          : 'Rebalancing keeps funds aligned with your plan. Use your monthly contributions to bring underweight funds back into range gradually.'}
      </p>

      <div className="space-y-3 mb-5">
        {steps.map((step) => {
          const Icon = step.icon
          return (
            <div key={step.number} className="flex gap-3">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold shrink-0">
                {step.number}
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm text-foreground">{step.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
              </div>
            </div>
          )
        })}
      </div>

      {currentDrift && currentDrift.length > 0 && (
        <div className="pt-4 border-t border-border">
          <p className="text-xs font-medium text-foreground mb-2">Current drift alerts:</p>
          <div className="space-y-1">
            {currentDrift.map((item) => (
              <p key={item.ticker} className="text-xs text-muted-foreground">
                <span className="font-medium">{item.ticker}</span> {item.drift > 0 ? '+' : ''}{item.drift.toFixed(1)}pp from target
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 p-3 rounded-lg bg-muted/30 border border-border/50">
        <p className="text-xs text-muted-foreground leading-relaxed">
          💡 <span className="font-medium text-foreground">Pro tip:</span> Regular contribution routing is more tax-efficient than active rebalancing.
          Save selling for compliance breaches only.
        </p>
      </div>
    </div>
  )
}
