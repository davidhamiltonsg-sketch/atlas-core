"use client"

import Link from "next/link"
import { Home, ChevronRight } from "lucide-react"
import type { ConstitutionId } from "@/lib/constitutions"

// Canonical breadcrumb label per top-level route. Sidebar.tsx uses slightly different wording
// per constitution (e.g. "Contributions" vs "Money you've added") — breadcrumbs stay neutral
// since they're a wayfinding aid, not the page's primary heading.
const ROUTE_LABELS: Record<string, string> = {
  "/next": "This month",
  "/mission-control": "Update Portfolio",
  "/portfolio": "Holdings & activity",
  "/contributions": "Contributions",
  "/reports": "Look-through report",
  "/risk": "Risk & concentration",
  "/forecast": "Forecast",
  "/compliance": "Compliance & status",
  "/settings": "Settings",
  "/admin/users": "Users",
}

interface BreadcrumbsProps {
  pathname: string
  constitutionId?: ConstitutionId
}

/** Slim "Home › Current page" trail — gives users a location cue and a one-click way back
 *  to the cockpit without relying on the browser back button. Renders nothing on "/" itself. */
export function Breadcrumbs({ pathname, constitutionId = "atlas-core" }: BreadcrumbsProps) {
  if (pathname === "/") return null

  // "/admin/users" -> also show the "Settings" parent segment, since that's where it lives in the sidebar.
  const segments: { href: string; label: string }[] = []
  if (pathname.startsWith("/admin")) segments.push({ href: "/settings", label: "Settings" })

  const label = ROUTE_LABELS[pathname] ?? pathname.slice(1).split("/").pop()?.replace(/-/g, " ") ?? pathname
  segments.push({ href: pathname, label })

  const sbr = constitutionId === "silicon-brick-road"

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1 min-w-0">
      <Link
        href="/"
        className={`flex items-center gap-1 shrink-0 hover:text-foreground transition-colors ${sbr ? "hover:text-sky-500" : "hover:text-violet-500"}`}
        aria-label="Portfolio overview"
      >
        <Home className="h-3 w-3" />
      </Link>
      {segments.map((seg, i) => (
        <span key={seg.href} className="flex items-center gap-1.5 min-w-0">
          <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
          {i === segments.length - 1
            ? <span className="truncate font-medium text-foreground/80">{seg.label}</span>
            : <Link href={seg.href} className={`truncate hover:text-foreground transition-colors ${sbr ? "hover:text-sky-500" : "hover:text-violet-500"}`}>{seg.label}</Link>
          }
        </span>
      ))}
    </nav>
  )
}
