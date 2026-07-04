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
  Wallet,
  BarChart3,
  Coins,
  CalendarDays,
  LineChart,
  Download,
  Landmark,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "./theme-toggle"
import { BrandMark } from "./brand/brand-mark"
import type { ConstitutionId } from "@/lib/constitutions"

type NavItem = { href: string; label: string; icon: React.ElementType }
type NavGroupDef = { label: string; items: NavItem[] }

// Per-constitution branding + navigation. Atlas Core (David) keeps the full surface; Silicon
// Brick Road (Dami) shows only the surfaces its constitution actually uses.
const BRAND: Record<ConstitutionId, { name: string; version: string }> = {
  "atlas-core":         { name: "Atlas Core",         version: "v1.5 · GDEA" },
  "silicon-brick-road": { name: "Silicon Brick Road", version: "v2.2 · SBR" },
}

const NAV: Record<ConstitutionId, NavGroupDef[]> = {
  "atlas-core": [
    { label: "Home", items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }] },
    { label: "Plan", items: [
      { href: "/governance", label: "Rules & Caps", icon: ShieldCheck },
      { href: "/calendar", label: "Calendar & Rules", icon: CalendarDays },
      { href: "/behaviour", label: "Staying Calm", icon: Brain },
    ] },
    { label: "Portfolio", items: [
      { href: "/portfolio", label: "Portfolio", icon: PieChart },
      { href: "/holdings", label: "Holdings", icon: Wallet },
      { href: "/rebalance", label: "Rebalance", icon: GitCompare },
      { href: "/trades", label: "Trades", icon: ArrowLeftRight },
      { href: "/contributions", label: "Contributions", icon: PiggyBank },
      { href: "/dividends", label: "Dividends", icon: Coins },
    ] },
    { label: "Insights", items: [
      { href: "/reports", label: "What You Own", icon: FileBarChart2 },
      { href: "/smart-money", label: "Research", icon: Landmark },
      { href: "/forecast", label: "Forecast", icon: TrendingUp },
      { href: "/risk", label: "Risk", icon: BarChart3 },
      { href: "/ytd", label: "YTD / P&L", icon: LineChart },
      { href: "/history", label: "History", icon: History },
    ] },
  ],
  "silicon-brick-road": [
    { label: "Home", items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }] },
    { label: "Constitution", items: [
      { href: "/governance", label: "The Constitution", icon: ShieldCheck },
      { href: "/behaviour", label: "Staying Calm", icon: Brain },
    ] },
    { label: "Portfolio", items: [
      { href: "/portfolio", label: "Portfolio", icon: PieChart },
      { href: "/holdings", label: "Holdings", icon: Wallet },
      { href: "/rebalance", label: "Rebalance", icon: GitCompare },
      { href: "/trades", label: "Trades", icon: ArrowLeftRight },
      { href: "/contributions", label: "Contributions", icon: PiggyBank },
      { href: "/dividends", label: "Dividends", icon: Coins },
    ] },
    { label: "Insights", items: [
      { href: "/reports", label: "Road Report", icon: FileBarChart2 },
      { href: "/risk", label: "Risk", icon: BarChart3 },
      { href: "/ytd", label: "YTD / P&L", icon: LineChart },
      { href: "/history", label: "History", icon: History },
    ] },
  ],
}

interface SidebarProps {
  open: boolean
  onClose: () => void
  isAdmin?: boolean
  constitutionId?: ConstitutionId
}

function NavLink({ href, label, icon: Icon, onClick, constitutionId = "atlas-core" }: { href: string; label: string; icon: React.ElementType; onClick: () => void; constitutionId?: ConstitutionId }) {
  const pathname = usePathname()
  const active = pathname === href
  const sbr = constitutionId === "silicon-brick-road"
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.98]",
        active
          ? sbr
            ? "bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300"
            : "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300"
          : "text-muted-foreground hover:bg-accent/80 hover:text-foreground"
      )}
    >
      {active && (
        <span className={cn("absolute left-0 inset-y-1.5 w-0.5 rounded-full", sbr ? "bg-sky-500" : "bg-violet-500")} />
      )}
      <Icon className={cn(
        "h-4 w-4 shrink-0 transition-all duration-200 group-hover:scale-110 motion-reduce:transform-none",
        active ? (sbr ? "text-sky-600 dark:text-sky-400" : "text-violet-600 dark:text-violet-400") : ""
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

export function Sidebar({ open, onClose, isAdmin = false, constitutionId = "atlas-core" }: SidebarProps) {
  const brand = BRAND[constitutionId]
  const groups = NAV[constitutionId]
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
            <BrandMark constitutionId={constitutionId} className="h-9 w-9 shrink-0 drop-shadow-md transition-transform duration-300 hover:scale-110 hover:-rotate-2 motion-reduce:transform-none" />
            <div>
              <p className="text-sm font-bold tracking-tight leading-none">{brand.name}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">{brand.version}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="lg:hidden flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {groups.map(group => (
            <NavGroup key={group.label} label={group.label}>
              {group.items.map(item => <NavLink key={item.href} {...item} onClick={onClose} constitutionId={constitutionId} />)}
            </NavGroup>
          ))}
          <NavGroup label="Settings">
            <NavLink href="/settings" label="Settings" icon={Settings} onClick={onClose} constitutionId={constitutionId} />
            <NavLink href="/export" label="Export" icon={Download} onClick={onClose} constitutionId={constitutionId} />
            {isAdmin && <NavLink href="/admin/users" label="Users" icon={Users} onClick={onClose} constitutionId={constitutionId} />}
          </NavGroup>
        </nav>

        {/* Footer */}
        <div className="border-t border-[hsl(var(--sidebar-border))] p-3 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground/70">{brand.name} · {brand.version}</span>
          <ThemeToggle />
        </div>
      </aside>
    </>
  )
}
