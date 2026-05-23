"use client"

import { Menu } from "lucide-react"

interface TopbarProps {
  onMenuClick: () => void
  title: string
  subtitle?: string
}

export function Topbar({ onMenuClick, title, subtitle }: TopbarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 lg:px-6">
      <button
        onClick={onMenuClick}
        className="lg:hidden flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        aria-label="Open menu"
      >
        <Menu className="h-4 w-4" />
      </button>
      <div>
        <h1 className="text-sm font-semibold leading-none">{title}</h1>
        {subtitle && (
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </header>
  )
}
