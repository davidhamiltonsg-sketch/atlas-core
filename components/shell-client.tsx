"use client"

import { useState } from "react"
import { Sidebar } from "./sidebar"
import { Topbar } from "./topbar"
import type { ConstitutionId } from "@/lib/constitutions"
import Link from "next/link"
import { LayoutDashboard, Radar, ShieldCheck, Wallet, BarChart3 } from "lucide-react"

interface ShellClientProps {
  title: string
  subtitle?: string
  userName?: string
  isAdmin?: boolean
  constitutionId?: ConstitutionId
  children: React.ReactNode
}

export function ShellClient({ title, subtitle, userName, isAdmin = false, constitutionId = "atlas-core", children }: ShellClientProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
        />
        <main className="atlas-stage command-stage flex-1 overflow-y-auto px-4 pb-24 pt-5 lg:px-10 lg:pb-12 print:block print:h-auto print:overflow-visible print:p-0 reveal-stack"><div className="mx-auto w-full max-w-[1600px]">{children}</div></main>
        <nav className="atlas-mobile-nav fixed inset-x-3 bottom-[max(.75rem,env(safe-area-inset-bottom))] z-30 grid grid-cols-5 rounded-2xl border border-border bg-card/90 p-1.5 shadow-2xl backdrop-blur-xl lg:hidden" aria-label="Primary navigation">
          <Link href="/" aria-label="Overview"><LayoutDashboard /><span>Overview</span></Link>
          <Link href={`/mission-control?portfolio=${constitutionId}`} aria-label="Mission Control"><Radar /><span>Mission</span></Link>
          <Link href="/portfolio" aria-label="Activity"><Wallet /><span>Activity</span></Link>
          <Link href="/risk" aria-label="Risk"><BarChart3 /><span>Risk</span></Link>
          <Link href="/governance" aria-label="Constitution"><ShieldCheck /><span>Rules</span></Link>
        </nav>
      </div>
    </div>
  )
}
