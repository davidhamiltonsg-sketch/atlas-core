'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { PostActionConfirmation } from '@/components/post-action-confirmation'

interface ForecastPageWrapperProps {
  children: React.ReactNode
}

export function ForecastPageWrapper({ children }: ForecastPageWrapperProps) {
  const searchParams = useSearchParams()
  const action = searchParams.get('action')
  const [lastAction, setLastAction] = useState(action)
  const [showConfirmation, setShowConfirmation] = useState<'update-holdings' | 'forecast-adjustment' | null>(null)

  // Adjust state during render (React's recommended replacement for setState-in-effect)
  // when the ?action= param changes; the effect below only ever sets state from its
  // setTimeout callback, which is the sanctioned "subscribe to an external timer" case.
  if (action !== lastAction) {
    setLastAction(action)
    setShowConfirmation(action === 'holdings-updated' ? 'update-holdings' : action === 'forecast-adjusted' ? 'forecast-adjustment' : null)
  }

  useEffect(() => {
    if (!showConfirmation) return
    const timer = setTimeout(() => setShowConfirmation(null), 8000)
    return () => clearTimeout(timer)
  }, [showConfirmation])

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
