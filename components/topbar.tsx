"use client"

import { Menu, LogOut, User } from "lucide-react"
import { logoutAction } from "@/app/logout-action"
import type { ConstitutionId } from "@/lib/constitutions"

interface TopbarProps {
  onMenuClick: () => void
  title: string
  subtitle?: string
  userName?: string
  constitutionId?: ConstitutionId
}

const VERSION_PILL: Record<ConstitutionId, { label: string; cls: string; dot: string }> = {
  "atlas-core":         { label: "v1.4", cls: "border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400", dot: "bg-indigo-500" },
  "silicon-brick-road": { label: "v2.1", cls: "border-teal-200 dark:border-teal-500/30 bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-400", dot: "bg-teal-500" },
}

export function Topbar({ onMenuClick, title, subtitle, userName, constitutionId = "atlas-core" }: TopbarProps) {
  const pill = VERSION_PILL[constitutionId]
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-card/80 backdrop-blur-sm px-4 lg:px-6">
      <button
        onClick={onMenuClick}
        className="lg:hidden flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent transition-colors"
        aria-label="Open menu"
      >
        <Menu className="h-4 w-4" />
      </button>

      <div className="flex-1 min-w-0">
        <h1 className="font-display text-base font-bold leading-none tracking-tight truncate">{title}</h1>
        {subtitle && (
          <p className="font-data mt-1 text-xs text-muted-foreground truncate">{subtitle}</p>
        )}
      </div>

      {/* Right: user + version pill + logout */}
      <div className="shrink-0 flex items-center gap-2">
        <span className={`hidden sm:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${pill.cls}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
          {pill.label}
        </span>

        {userName && (
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <User className="h-3 w-3" />
            <span className="max-w-[100px] truncate">{userName}</span>
          </div>
        )}

        <form action={logoutAction}>
          <button
            type="submit"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    </header>
  )
}
