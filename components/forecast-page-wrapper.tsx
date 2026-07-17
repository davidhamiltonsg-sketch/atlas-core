'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { PostActionConfirmation } from '@/components/post-action-confirmation'

interface ForecastPageWrapperProps {
  children: React.ReactNode
}

export function ForecastPageWrapper({ children }: ForecastPageWrapperProps) {
  const searchParams = useSearchParams()
  const [showConfirmation, setShowConfirmation] = useState<'update-holdings' | 'forecast-adjustment' | null>(null)

  useEffect(() => {
    const action = searchParams.get('action')
    if (action === 'holdings-updated' || action === 'forecast-adjusted') {
      setShowConfirmation(action === 'holdings-updated' ? 'update-holdings' : 'forecast-adjustment')
      // Auto-dismiss after 8 seconds
      const timer = setTimeout(() => setShowConfirmation(null), 8000)
      return () => clearTimeout(timer)
    }
  }, [searchParams])

  return (
    <>
      {showConfirmation && (
        <PostActionConfirmation
          action={showConfirmation}
          onDismiss={() => setShowConfirmation(null)}
        />
      )}
      {children}
    </>
  )
}
