"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"

export function CollapsibleSection({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string
  badge?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full text-left group mb-3"
      >
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex-1">
          {title}
        </h2>
        {badge}
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-muted-foreground transition-all ${
            open ? "rotate-0" : "-rotate-90"
          }`}
        />
      </button>
      {open && children}
    </div>
  )
}
