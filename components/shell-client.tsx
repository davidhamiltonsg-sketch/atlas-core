"use client"

import { useState } from "react"
import { Sidebar } from "./sidebar"
import { Topbar } from "./topbar"
import type { ConstitutionId } from "@/lib/constitutions"

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
    <div data-theme={constitutionId === "silicon-brick-road" ? "sbr" : "atlas-core"} className="flex h-screen overflow-hidden bg-background print:block print:h-auto print:overflow-visible">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} isAdmin={isAdmin} constitutionId={constitutionId} />
      <div className="flex flex-1 flex-col overflow-hidden print:block print:h-auto print:overflow-visible">
        <Topbar
          onMenuClick={() => setSidebarOpen(true)}
          title={title}
          subtitle={subtitle}
          userName={userName}
          constitutionId={constitutionId}
        />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 print:block print:h-auto print:overflow-visible print:p-0">{children}</main>
      </div>
    </div>
  )
}
