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
  History,
  ArrowLeftRight,
  PiggyBank,
  GitCompare,
  Star,
  BarChart3,
  Coins,
  CalendarDays,
  Download,
  Zap,
  Landmark,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "./theme-toggle"

// Home = the one-stop dashboard (action + rule-check + performance).
const homeNav = [
  { href: "/",              label: "Dashboard",        icon: LayoutDashboard },
]

// Plan = the rules and discipline layer.
const planNav = [
  { href: "/governance",    label: "Rules & Caps",     icon: ShieldCheck },
  { href: "/calendar",      label: "Calendar & Rules", icon: CalendarDays },
  { href: "/behaviour",     label: "Staying Calm",     icon: Brain },
]

// Portfolio = your money and its records.
const portfolioNav = [
  { href: "/portfolio",     label: "Portfolio",        icon: PieChart },
  { href: "/holdings",      label: "Holdings",         icon: Star },
  { href: "/rebalance",     label: "Rebalance",        icon: GitCompare },
  { href: "/trades",        label: "Trades",           icon: ArrowLeftRight },
  { href: "/contributions", label: "Contributions",    icon: PiggyBank },
  { href: "/dividends",     label: "Dividends",        icon: Coins },
]

// Insights = the optional deep-dive surfaces (not part of the monthly 5-minute check).
const insightsNav = [
  { href: "/command-centre",label: "Command Centre",   icon: Zap },
  { href: "/smart-money",   label: "Smart Money",      icon: Landmark },
  { href: "/reports",       label: "What You Own",     icon: FileBarChart2 },
  { href: "/forecast",      label: "Forecast",         icon: TrendingUp },
  { href: "/risk",          label: "Risk",             icon: BarChart3 },
  { href: "/ytd",           label: "YTD / P&L",        icon: CalendarDays },
  { href: "/history",       label: "History",          icon: History },
]

interface SidebarProps {
  open: boolean
  onClose: () => void
  isAdmin?: boolean
}

function NavLink({ href, label, icon: Icon, onClick }: { href: string; label: string; icon: React.ElementType; onClick: () => void }) {
  const pathname = usePathname()
  const active = pathname === href
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
        active
          ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
          : "text-muted-foreground hover:bg-accent/80 hover:text-foreground"
      )}
    >
      {active && (
        <span className="absolute left-0 inset-y-1.5 w-0.5 rounded-full bg-indigo-500" />
      )}
      <Icon className={cn(
        "h-4 w-4 shrink-0 transition-colors",
        active ? "text-indigo-600 dark:text-indigo-400" : ""
      )} />
      {label}
    </Link>
  )
}

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{label}</p>
      {children}
    </div>
  )
}

export function Sidebar({ open, onClose, isAdmin = false }: SidebarProps) {
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
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">v6.7 · GDEA</p>
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
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          <NavGroup label="Home">
            {homeNav.map(item => <NavLink key={item.href} {...item} onClick={onClose} />)}
          </NavGroup>
          <NavGroup label="Plan">
            {planNav.map(item => <NavLink key={item.href} {...item} onClick={onClose} />)}
          </NavGroup>
          <NavGroup label="Portfolio">
            {portfolioNav.map(item => <NavLink key={item.href} {...item} onClick={onClose} />)}
          </NavGroup>
          <NavGroup label="Insights">
            {insightsNav.map(item => <NavLink key={item.href} {...item} onClick={onClose} />)}
          </NavGroup>
          <NavGroup label="Settings">
            <NavLink href="/settings" label="Settings" icon={Settings} onClick={onClose} />
            <NavLink href="/export" label="Export" icon={Download} onClick={onClose} />
            {isAdmin && <NavLink href="/admin/users" label="Users" icon={Users} onClick={onClose} />}
          </NavGroup>
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
