import { Loader2 } from "lucide-react"

// Calm global loading state — shown while a page's live data (prices, holdings) loads.
export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30">
          <span className="text-base font-black text-white tracking-tight">AC</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading your portfolio…
        </div>
      </div>
    </div>
  )
}
