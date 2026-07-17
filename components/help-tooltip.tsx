'use client'

import { HelpCircle } from 'lucide-react'
import { useState } from 'react'

interface HelpTooltipProps {
  title: string
  description: string
  link?: { text: string; href: string }
}

export function HelpTooltip({ title, description, link }: HelpTooltipProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="relative inline-block">
      <button
        className="inline-flex h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Help"
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        onClick={() => setIsOpen(!isOpen)}
      >
        <HelpCircle className="h-4 w-4" />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-2 w-64 rounded-lg border border-border bg-card p-3 shadow-lg bottom-full right-0 mb-2">
          <p className="font-semibold text-sm text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{description}</p>
          {link && (
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline block mt-2"
            >
              {link.text} →
            </a>
          )}
        </div>
      )}
    </div>
  )
}
