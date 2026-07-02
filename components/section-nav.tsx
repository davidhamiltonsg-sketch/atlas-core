"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

// ─── The 5-section information architecture ──────────────────────────────────
// Sidebar shows the 5 section roots; each section's sub-pages appear as tabs at the
// top of the page (rendered by <SectionTabs/> in the Shell). One calm top level;
// all the depth lives behind tabs.
export interface NavTab { href: string; label: string }
export interface NavSection { id: string; label: string; root: string; tabs: NavTab[] }

export const SECTIONS: NavSection[] = [
  { id: "home", label: "Dashboard", root: "/", tabs: [] },
  {
    id: "portfolio", label: "Portfolio", root: "/portfolio",
    tabs: [
      { href: "/portfolio", label: "Holdings" },
      { href: "/holdings", label: "Allocation" },
      { href: "/rebalance", label: "Rebalance" },
      { href: "/trades", label: "Trades" },
      { href: "/contributions", label: "Contributions" },
      { href: "/dividends", label: "Dividends" },
    ],
  },
  {
    id: "plan", label: "Plan", root: "/governance",
    tabs: [
      { href: "/governance", label: "Rules & Caps" },
      { href: "/calendar", label: "Calendar" },
      { href: "/behaviour", label: "Staying Calm" },
    ],
  },
  {
    id: "insights", label: "Insights", root: "/reports",
    tabs: [
      { href: "/reports", label: "What You Own" },
      { href: "/smart-money", label: "Research" },
      { href: "/forecast", label: "Forecast" },
      { href: "/ytd", label: "YTD / P&L" },
      { href: "/risk", label: "Risk" },
      { href: "/history", label: "History" },
    ],
  },
  {
    id: "settings", label: "Settings", root: "/settings",
    tabs: [
      { href: "/settings", label: "Settings" },
      { href: "/export", label: "Export" },
    ],
  },
]

const matches = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/")

/** Which section a path belongs to (by root or any of its tab hrefs). */
export function sectionForPath(pathname: string): NavSection | undefined {
  return SECTIONS.find(s => matches(pathname, s.root) || s.tabs.some(t => matches(pathname, t.href)))
}

// Tab bar for the current section — rendered at the top of every page via the Shell.
export function SectionTabs() {
  const pathname = usePathname()
  const section = sectionForPath(pathname)
  if (!section || section.tabs.length === 0) return null
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
      {section.tabs.map(t => {
        const active = matches(pathname, t.href)
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "shrink-0 px-3 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px",
              active
                ? "border-indigo-500 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40 rounded-t-lg",
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
