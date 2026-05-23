"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  PieChart,
  ShieldCheck,
  Brain,
  FileBarChart2,
  TrendingUp,
  X,
  Users,
  Settings,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "./theme-toggle"

const nav = [
  { href: "/",              label: "Dashboard",  icon: LayoutDashboard },
  { href: "/portfolio",     label: "Portfolio",  icon: PieChart },
  { href: "/governance",    label: "Governance", icon: ShieldCheck },
  { href: "/behaviour",     label: "Behaviour",  icon: Brain },
  { href: "/reports",       label: "Reports",    icon: FileBarChart2 },
  { href: "/forecast",      label: "Forecast",   icon: TrendingUp },
  { href: "/admin/users",   label: "Users",      icon: Users },
  { href: "/settings",      label: "Settings",   icon: Settings },
]

interface SidebarProps {
  open: boolean
  onClose: () => void
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname()

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r transition-transform duration-200 lg:translate-x-0 lg:static lg:z-auto",
          "bg-[hsl(var(--sidebar-bg))] border-[hsl(var(--sidebar-border))]",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between px-4 border-b border-[hsl(var(--sidebar-border))]">
          <div className="flex items-center gap-3">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-md shadow-indigo-500/30">
              <span className="text-[11px] font-black text-white tracking-tight">AC</span>
              <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/20" />
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight leading-none">Atlas Core</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">v5.2 · GDEA</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 p-3 pt-4">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={cn(
                  "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                    : "text-muted-foreground hover:bg-accent/80 hover:text-foreground"
                )}
              >
                {active && (
                  <span className="absolute left-0 inset-y-2 w-0.5 rounded-full bg-indigo-500" />
                )}
                <Icon className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  active ? "text-indigo-600 dark:text-indigo-400" : ""
                )} />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-[hsl(var(--sidebar-border))] p-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[11px] text-muted-foreground">All systems operational</span>
          </div>
          <ThemeToggle />
        </div>
      </aside>
    </>
  )
}
