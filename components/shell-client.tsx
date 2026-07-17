"use client"

import { useState } from "react"
import { Sidebar } from "./sidebar"
import { Topbar } from "./topbar"
import type { ConstitutionId } from "@/lib/constitutions"
import Link from "next/link"
import { LayoutDashboard, Radar, ShieldCheck, Wallet, CalendarCheck } from "lucide-react"
import { usePathname } from "next/navigation"

interface ShellClientProps {
  title: string
  subtitle?: string
  userName?: string
  isAdmin?: boolean
  constitutionId?: ConstitutionId
  canSwitchPortfolio?: boolean
  children: React.ReactNode
}

export function ShellClient({ title, subtitle, userName, isAdmin = false, constitutionId = "atlas-core", canSwitchPortfolio = false, children }: ShellClientProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()
  // Five ritual slots: the monthly one-screen answer (/next) replaces Risk — Risk stays a
  // sidebar destination; the phone bar is for the monthly loop (see → act → verify).
  const mobileLinks = [
    { href: "/", label: "Overview", icon: LayoutDashboard, active: pathname === "/" },
    { href: "/next", label: "This month", icon: CalendarCheck, active: pathname === "/next" },
    { href: `/mission-control?portfolio=${constitutionId}`, label: "Mission", icon: Radar, active: pathname === "/mission-control" },
    { href: "/portfolio", label: "Activity", icon: Wallet, active: pathname === "/portfolio" },
    { href: "/compliance", label: "Compliance", icon: ShieldCheck, active: pathname === "/compliance" },
  ]

  return (
    <div data-theme={constitutionId === "silicon-brick-road" ? "sbr" : "atlas-core"} className="atlas-shell command-shell flex h-dvh min-h-dvh overflow-hidden print:block print:h-auto print:overflow-visible">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} isAdmin={isAdmin} constitutionId={constitutionId} />
      <div className="flex flex-1 flex-col overflow-hidden print:block print:h-auto print:overflow-visible">
        <Topbar
          onMenuClick={() => setSidebarOpen(true)}
          title={title}
          subtitle={subtitle}
          userName={userName}
          constitutionId={constitutionId}
          canSwitchPortfolio={canSwitchPortfolio}
        />
        <main className="atlas-stage command-stage flex-1 overflow-y-auto px-4 pb-24 pt-5 lg:px-10 lg:pb-12 print:block print:h-auto print:overflow-visible print:p-0 reveal-stack"><div className="mx-auto w-full max-w-[1600px]">{children}</div></main>
        <nav className="atlas-mobile-nav fixed inset-x-3 bottom-[max(.75rem,env(safe-area-inset-bottom))] z-30 grid grid-cols-5 rounded-2xl border border-border bg-card/90 p-1.5 shadow-2xl backdrop-blur-xl lg:hidden" aria-label="Primary navigation">
          {mobileLinks.map(({href,label,icon:Icon,active})=><Link key={label} href={href} aria-label={label} aria-current={active?"page":undefined} className={active?"is-active":undefined}><Icon /><span>{label}</span></Link>)}
        </nav>
      </div>
    </div>
  )
}
