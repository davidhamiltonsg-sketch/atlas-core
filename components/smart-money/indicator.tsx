'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Landmark } from 'lucide-react'
import { SmartMoneyStats } from '@/lib/smart-money/types'

export function SmartMoneyIndicator({ className = '' }: { className?: string }) {
  const [stats,     setStats]     = useState<SmartMoneyStats | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    fetch('/api/smart-money?atlasOnly=true&daysBack=30')
      .then(r => r.json())
      .then(d => setStats(d.stats ?? null))
      .catch(() => {})
  }, [])

  if (dismissed || !stats || stats.atlasOverlaps === 0) return null

  const parts: string[] = []
  if (stats.congressBuys  > 0) parts.push(`${stats.congressBuys} Congress buy${stats.congressBuys > 1 ? 's' : ''}`)
  if (stats.congressSells > 0) parts.push(`${stats.congressSells} sell${stats.congressSells > 1 ? 's' : ''}`)
  if (stats.insiderBuys   > 0) parts.push(`${stats.insiderBuys} insider buy${stats.insiderBuys > 1 ? 's' : ''}`)
  if (stats.insiderSells  > 0) parts.push(`${stats.insiderSells} insider sell${stats.insiderSells > 1 ? 's' : ''}`)

  return (
    <div className={`flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-4 py-2.5 text-xs ${className}`}>
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300/90">
        <Landmark className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        <span>
          <span className="font-semibold text-amber-700 dark:text-amber-300">Smart Money:</span>{' '}
          {stats.atlasOverlaps} overlap{stats.atlasOverlaps > 1 ? 's' : ''} with your holdings (30d)
          {parts.length > 0 && ` — ${parts.join(', ')}`}
        </span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Link href="/smart-money?atlasOnly=true" className="font-semibold text-amber-600 dark:text-amber-400 hover:underline">View →</Link>
        <button onClick={() => setDismissed(true)} className="text-amber-600/70 hover:text-amber-500 text-base leading-none">×</button>
      </div>
    </div>
  )
}
