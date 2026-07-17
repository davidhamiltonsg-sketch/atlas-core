'use client'

import { CheckCircle2, ArrowRight } from 'lucide-react'
import Link from 'next/link'

interface PostActionConfirmationProps {
  action: 'update-holdings' | 'forecast-adjustment'
  onDismiss: () => void
}

export function PostActionConfirmation({ action, onDismiss }: PostActionConfirmationProps) {
  const configs = {
    'update-holdings': {
      icon: CheckCircle2,
      title: '✓ Portfolio Updated',
      message: 'Your holdings have been synced and forecast recalculated.',
      cta: 'See your new forecast',
      link: '/forecast',
      color: 'bg-green-500/10 border-green-500/30',
      textColor: 'text-green-700 dark:text-green-300',
    },
    'forecast-adjustment': {
      icon: CheckCircle2,
      title: '✓ Settings Updated',
      message: 'Your forecast assumptions have been adjusted.',
      cta: 'Review your settings',
      link: '/settings',
      color: 'bg-blue-500/10 border-blue-500/30',
      textColor: 'text-blue-700 dark:text-blue-300',
    },
  }

  const config = configs[action]
  const Icon = config.icon

  return (
    <div className={`rounded-xl border p-4 ${config.color} mb-4`}>
      <div className="flex items-start gap-3">
        <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${config.textColor}`} />
        <div className="flex-1">
          <p className={`font-bold ${config.textColor}`}>{config.title}</p>
          <p className="text-sm text-muted-foreground mt-1 mb-3">{config.message}</p>
          <div className="flex gap-2">
            <Link
              href={config.link}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              {config.cta}
              <ArrowRight className="h-3 w-3" />
            </Link>
            <button
              onClick={onDismiss}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
