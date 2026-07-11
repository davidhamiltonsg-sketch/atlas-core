"use client"

import { useState } from "react"
import { Sidebar } from "./sidebar"
import { Topbar } from "./topbar"
import type { ConstitutionId } from "@/lib/constitutions"
import Link from "next/link"
import { LayoutDashboard, PieChart, Radar, ShieldCheck, Wallet } from "lucide-react"

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
    <div data-theme={constitutionId === "silicon-brick-road" ? "sbr" : "atlas-core"} className="atlas-shell flex h-screen overflow-hidden bg-background print:block print:h-auto print:overflow-visible">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} isAdmin={isAdmin} constitutionId={constitutionId} />
      <div className="flex flex-1 flex-col overflow-hidden print:block print:h-auto print:overflow-visible">
        <Topbar
          onMenuClick={() => setSidebarOpen(true)}
          title={title}
          subtitle={subtitle}
          userName={userName}
          constitutionId={constitutionId}
        />
        <main className="atlas-stage flex-1 overflow-y-auto px-4 pb-24 pt-5 lg:px-8 lg:pb-10 print:block print:h-auto print:overflow-visible print:p-0 reveal-stack"><div className="mx-auto w-full max-w-[1540px]">{children}</div></main>
        <nav className="atlas-mobile-nav fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 rounded-2xl border border-border bg-card/90 p-1.5 shadow-2xl backdrop-blur-xl lg:hidden" aria-label="Primary navigation">
          <Link href="/" aria-label="Cockpit"><LayoutDashboard /></Link>
          <Link href="/portfolio" aria-label="Portfolio"><PieChart /></Link>
          <Link href={`/mission-control?portfolio=${constitutionId}`} aria-label="Mission Control"><Radar /></Link>
          <Link href="/governance" aria-label="Constitution"><ShieldCheck /></Link>
          <Link href="/holdings" aria-label="Holdings"><Wallet /></Link>
        </nav>
      </div>
    </div>
  )
}
