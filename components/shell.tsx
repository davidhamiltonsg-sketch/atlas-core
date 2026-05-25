"use client"

import { useState } from "react"
import { Sidebar } from "./sidebar"
import { Topbar } from "./topbar"

interface ShellProps {
  title: string
  subtitle?: string
  userName?: string
  isAdmin?: boolean
  children: React.ReactNode
}

export function Shell({ title, subtitle, userName, isAdmin = false, children }: ShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-background print:block print:h-auto print:overflow-visible">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} isAdmin={isAdmin} />
      <div className="flex flex-1 flex-col overflow-hidden print:block print:h-auto print:overflow-visible">
        <Topbar
          onMenuClick={() => setSidebarOpen(true)}
          title={title}
          subtitle={subtitle}
          userName={userName}
        />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 print:block print:h-auto print:overflow-visible print:p-0">{children}</main>
      </div>
    </div>
  )
}
