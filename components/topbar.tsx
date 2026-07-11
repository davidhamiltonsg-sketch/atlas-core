"use client"

import { Menu, LogOut, User } from "lucide-react"
import { logoutAction } from "@/app/logout-action"
import { selectPortfolio } from "@/app/actions/portfolio-selection"
import type { ConstitutionId } from "@/lib/constitutions"

interface TopbarProps {
  onMenuClick: () => void
  title: string
  subtitle?: string
  userName?: string
  constitutionId?: ConstitutionId
}

const VERSION_PILL: Record<ConstitutionId, { label: string; cls: string; dot: string }> = {
  "atlas-core":         { label: "v1.5", cls: "border-violet-200 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400", dot: "bg-violet-500" },
  "silicon-brick-road": { label: "v3.2", cls: "border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400", dot: "bg-sky-500" },
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
        {userName && (
          <form action={selectPortfolio} className="hidden sm:block">
            <select
              name="portfolio"
              value={constitutionId}
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
              aria-label="Active portfolio"
              className="h-8 rounded-lg border border-border bg-background px-2 text-[11px] font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="atlas-core">Atlas Core</option>
              <option value="silicon-brick-road">Silicon Brick Road</option>
            </select>
          </form>
        )}
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
            title="Sign out" aria-label="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    </header>
  )
}
