'use client'

import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Circle, ChevronRight, TrendingDown, TrendingUp } from 'lucide-react'

interface ComplianceIndicator {
  label: string
  status: 'compliant' | 'caution' | 'critical'
  value: string
  detail: string
  action?: string
}

interface GovernanceRule {
  category: string
  rule: string
  status: 'pass' | 'warning' | 'fail'
  description: string
  nextAction?: string
}

interface GovernanceComplianceDashboardProps {
  portfolio: 'atlas-core' | 'silicon-brick-road'
  indicators: ComplianceIndicator[]
  rules: GovernanceRule[]
  allocationChart?: React.ReactNode
  riskMetrics?: {
    maxDrawdown: number
    volatility: number
    concentration: number
  }
  nextActions: Array<{
    priority: 'critical' | 'high' | 'medium' | 'low'
    action: string
    trigger: string
    deadline?: string
    link?: string
  }>
}

const statusColors = {
  atlas: {
    compliant: 'border-green-500/30 bg-green-500/5',
    caution: 'border-amber-500/30 bg-amber-500/5',
    critical: 'border-red-500/30 bg-red-500/5',
  },
  sbr: {
    compliant: 'border-cyan-500/30 bg-cyan-500/5',
    caution: 'border-yellow-500/30 bg-yellow-500/5',
    critical: 'border-orange-500/30 bg-orange-500/5',
  },
}

const statusIcons = {
  compliant: CheckCircle2,
  caution: AlertTriangle,
  critical: AlertTriangle,
}

const statusTextColors = {
  compliant: 'text-green-500',
  caution: 'text-amber-500',
  critical: 'text-red-500',
}

export function GovernanceComplianceDashboard({
  portfolio,
  indicators,
  rules,
  riskMetrics,
  nextActions,
}: GovernanceComplianceDashboardProps) {
  const palette = portfolio === 'atlas-core' ? statusColors.atlas : statusColors.sbr
  const portfolioName = portfolio === 'atlas-core' ? 'Atlas Core' : 'Silicon Brick Road'

  const criticalCount = nextActions.filter(a => a.priority === 'critical').length
  const overallStatus = criticalCount > 0 ? 'critical' :
    indicators.some(i => i.status === 'critical') ? 'critical' :
    indicators.some(i => i.status === 'caution') ? 'caution' : 'compliant'

  return (
    <div className="space-y-6">
      {/* Status Overview */}
      <div className={`rounded-xl border p-6 ${palette[overallStatus]}`}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold mb-1">{portfolioName} Governance Status</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Portfolio compliance with constitutional rules and governance tiers
            </p>
          </div>
          <div className="text-right">
            <div className={`text-3xl font-black capitalize ${statusTextColors[overallStatus]}`}>
              {overallStatus === 'compliant' ? '✓ Compliant' :
               overallStatus === 'caution' ? '⚠ Review' : '🚨 Action'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {overallStatus === 'compliant' ? 'All rules satisfied' :
               overallStatus === 'caution' ? 'Some rules approaching limits' : 'Governance action required'}
            </p>
          </div>
        </div>
      </div>

      {/* Compliance Indicators Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {indicators.map((indicator) => {
          const Icon = statusIcons[indicator.status]
          return (
            <div
              key={indicator.label}
              className={`rounded-lg border p-4 ${palette[indicator.status]}`}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-semibold">{indicator.label}</h3>
                <Icon className={`h-4 w-4 ${statusTextColors[indicator.status]}`} />
              </div>
              <p className="text-2xl font-black tabular-nums mb-1">{indicator.value}</p>
              <p className="text-xs text-muted-foreground mb-2">{indicator.detail}</p>
              {indicator.action && (
                <p className="text-xs font-medium text-foreground">{indicator.action}</p>
              )}
            </div>
          )
        })}
      </div>

      {/* Risk Metrics */}
      {riskMetrics && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-bold mb-4">Risk Metrics</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Maximum Drawdown</p>
              <p className="text-lg font-black tabular-nums text-red-500">
                {(riskMetrics.maxDrawdown * 100).toFixed(1)}%
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">20-year period</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Annualized Volatility</p>
              <p className="text-lg font-black tabular-nums text-amber-500">
                {(riskMetrics.volatility * 100).toFixed(1)}%
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">Historical estimate</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Concentration Risk</p>
              <p className="text-lg font-black tabular-nums text-orange-500">
                {(riskMetrics.concentration * 100).toFixed(1)}%
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">Top 3 holdings</p>
            </div>
          </div>
        </div>
      )}

      {/* Governance Rules */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-bold">Governance Rules</h3>
          <p className="text-xs text-muted-foreground mt-1">Constitutional compliance check</p>
        </div>
        <div className="divide-y divide-border">
          {rules.map((rule) => (
            <div key={`${rule.category}-${rule.rule}`} className="px-5 py-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                    {rule.category}
                  </p>
                  <p className="text-sm font-semibold mt-1">{rule.rule}</p>
                </div>
                <div className={`text-xs font-bold px-2 py-1 rounded-full ${
                  rule.status === 'pass' ? 'bg-green-500/10 text-green-600' :
                  rule.status === 'warning' ? 'bg-amber-500/10 text-amber-600' :
                  'bg-red-500/10 text-red-600'
                }`}>
                  {rule.status === 'pass' ? '✓ PASS' :
                   rule.status === 'warning' ? '⚠ WARNING' : '✗ FAIL'}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-2">{rule.description}</p>
              {rule.nextAction && (
                <p className="text-xs font-medium text-foreground bg-muted/30 rounded px-2 py-1">
                  → {rule.nextAction}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Next Actions */}
      {nextActions.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-sm font-bold">Action Items</h3>
            <p className="text-xs text-muted-foreground mt-1">Governance-required or recommended actions</p>
          </div>
          <div className="divide-y divide-border">
            {nextActions.map((action, idx) => {
              const rowClass = `px-5 py-4 flex items-start justify-between gap-2 ${
                action.priority === 'critical' ? 'bg-red-500/5 border-l-2 border-red-500' :
                action.priority === 'high' ? 'bg-orange-500/5 border-l-2 border-orange-500' :
                action.priority === 'medium' ? 'bg-amber-500/5 border-l-2 border-amber-500' :
                'bg-blue-500/5 border-l-2 border-blue-500'
              }`
              const body = (
                <>
                  <div className="flex items-start gap-3">
                    <Circle className={`h-2 w-2 mt-2 shrink-0 ${
                      action.priority === 'critical' ? 'fill-red-500 text-red-500' :
                      action.priority === 'high' ? 'fill-orange-500 text-orange-500' :
                      action.priority === 'medium' ? 'fill-amber-500 text-amber-500' :
                      'fill-blue-500 text-blue-500'
                    }`} />
                    <div>
                      <p className="text-sm font-semibold">{action.action}</p>
                      <p className="text-xs text-muted-foreground mt-1">{action.trigger}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {action.deadline && (
                      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                        {action.deadline}
                      </span>
                    )}
                    {action.link && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </>
              )
              return action.link ? (
                <Link key={idx} href={action.link} className={`${rowClass} hover:bg-accent/50 transition-colors`}>
                  {body}
                </Link>
              ) : (
                <div key={idx} className={rowClass}>
                  {body}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
