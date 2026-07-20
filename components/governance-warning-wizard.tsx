'use client'

import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, ArrowRight, X } from 'lucide-react'

interface GovernanceWarningWizardProps {
  status: 'caution' | 'critical'
  portfolioName: string
  issues: Array<{ label: string; detail: string }>
  nextSteps: Array<{ step: number; title: string; action: string }>
  onDismiss: () => void
}

export function GovernanceWarningWizard({
  status,
  portfolioName,
  issues,
  nextSteps,
  onDismiss,
}: GovernanceWarningWizardProps) {
  const isCritical = status === 'critical'
  const bgColor = isCritical ? 'bg-red-500/10 border-red-500/30' : 'bg-amber-500/10 border-amber-500/30'
  const textColor = isCritical ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'
  const borderColor = isCritical ? 'border-red-500/50' : 'border-amber-500/50'

  // Portal straight to document.body — see update-portfolio-modal.tsx: a `backdrop-filter`
  // on an ancestor `bg-card` panel creates a new containing block for `position: fixed`,
  // silently shrinking this dialog to that panel's box instead of the real viewport.
  return createPortal(
    <div className={`fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4`}>
      <div className={`rounded-2xl border ${bgColor} ${borderColor} max-w-2xl w-full max-h-[90vh] overflow-y-auto`}>
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-inherit">
          <div className="flex items-start gap-3 flex-1">
            <AlertTriangle className={`h-5 w-5 shrink-0 mt-0.5 ${textColor}`} />
            <div>
              <h2 className={`text-lg font-bold ${textColor}`}>
                {isCritical ? 'Critical Governance Alert' : 'Governance Caution'}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {portfolioName} requires immediate review
              </p>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Issues */}
        <div className="p-6 border-b border-inherit">
          <h3 className="font-semibold mb-3 text-sm">Issues Detected</h3>
          <div className="space-y-2.5">
            {issues.map((issue, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-muted/30">
                <p className="font-medium text-sm">{issue.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{issue.detail}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Next Steps */}
        <div className="p-6 border-b border-inherit">
          <h3 className="font-semibold mb-4 text-sm">Required Actions</h3>
          <div className="space-y-3">
            {nextSteps.map((item) => (
              <div key={item.step} className="flex gap-4">
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold shrink-0">
                  {item.step}
                </div>
                <div className="flex-1 pt-0.5">
                  <p className="font-medium text-sm">{item.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">{item.action}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 bg-muted/10 flex gap-3">
          <button
            onClick={onDismiss}
            className="flex-1 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-sm font-medium"
          >
            Dismiss
          </button>
          <a
            href="/mission-control"
            className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium inline-flex items-center justify-center gap-2"
          >
            Go to Mission Control
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>,
    document.body,
  )
}
