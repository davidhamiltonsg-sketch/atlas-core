'use client'

import { useState } from 'react'
import { GovernanceWarningWizard } from '@/components/governance-warning-wizard'

interface GovernanceWrapperProps {
  status: 'compliant' | 'caution' | 'critical'
  portfolioName: string
  children: React.ReactNode
}

export function GovernanceWrapper({ status, portfolioName, children }: GovernanceWrapperProps) {
  const [showWizard, setShowWizard] = useState(status === 'critical' || status === 'caution')

  if (showWizard && (status === 'critical' || status === 'caution')) {
    const issues = status === 'critical'
      ? [
          { label: 'Hard cap breached', detail: 'One or more positions exceed their constitutional hard caps' },
          { label: 'Look-through breach', detail: 'Company or sector concentration exceeds governance limits' },
        ]
      : [
          { label: 'Position drift', detail: 'Multiple positions are drifting outside tolerance bands' },
          { label: 'Data freshness', detail: 'Portfolio snapshot is more than 7 days old' },
        ]

    const nextSteps = status === 'critical'
      ? [
          { step: 1, title: 'Review the breach', action: 'Open Mission Control to see which position exceeded its cap' },
          { step: 2, title: 'Execute a corrective trade', action: 'Sell enough to return to compliance' },
          { step: 3, title: 'Verify compliance', action: 'Return here to confirm all checks pass' },
        ]
      : [
          { step: 1, title: 'Check position drift', action: 'Review which holdings have drifted most' },
          { step: 2, title: 'Plan rebalance', action: 'Decide if rebalancing is needed at next contribution window' },
          { step: 3, title: 'Update holdings', action: 'Refresh portfolio data from broker' },
        ]

    return (
      <>
        <GovernanceWarningWizard
          status={status as 'caution' | 'critical'}
          portfolioName={portfolioName}
          issues={issues}
          nextSteps={nextSteps}
          onDismiss={() => setShowWizard(false)}
        />
        {children}
      </>
    )
  }

  return <>{children}</>
}
