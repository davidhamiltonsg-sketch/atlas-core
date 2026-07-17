'use client'

import { HelpCircle } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface HelpTooltipProps {
  title: string
  description: string
  link?: { text: string; href: string }
}

export function HelpTooltip({ title, description, link }: HelpTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="inline-flex h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Help"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <div className="space-y-1.5">
            <p className="font-semibold text-sm">{title}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
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
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
