"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { DownloadCloud } from "lucide-react"
import { IBKRActivityImport } from "@/components/ibkr-activity-import"

// The IBKRActivityImport modal is the ONLY path that fills the contribution and
// dividend ledgers from the broker, and it previously wasn't mounted on any page —
// the feature existed but was unreachable. This launcher puts it where the data
// lands: the Contributions page.

export function ActivityImportLauncher() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
      >
        <DownloadCloud className="h-4 w-4" />
        Import activity from IBKR
      </button>
      {open && (
        <IBKRActivityImport
          onClose={() => setOpen(false)}
          onImported={() => router.refresh()}
        />
      )}
    </>
  )
}
