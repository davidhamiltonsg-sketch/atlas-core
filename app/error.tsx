"use client"

import { useEffect, useState } from "react"
import { AtlasCoreMark, SbrMark, AtlasUniverseMark } from "@/components/brand/brand-mark"

type Hint = "atlas-core" | "silicon-brick-road" | null

// Error boundaries can't read the httpOnly session cookie server-side (this must be a
// Client Component), so it reads the non-auth portfolio_hint cookie directly — the same
// cookie app/loading.tsx reads server-side, just via document.cookie since it carries no
// auth value and was always meant to be readable.
function readPortfolioHint(): Hint {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(/(?:^|; )portfolio_hint=([^;]+)/)
  const value = match ? decodeURIComponent(match[1]) : null
  return value === "atlas-core" || value === "silicon-brick-road" ? value : null
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [hint] = useState<Hint>(() => readPortfolioHint())

  useEffect(() => {
    console.error(error)
  }, [error])

  const isDbError =
    error.message?.includes("DATABASE_URL") ||
    error.message?.includes("libsql") ||
    error.message?.includes("prisma")

  const Mark = hint === "silicon-brick-road" ? SbrMark : hint === "atlas-core" ? AtlasCoreMark : AtlasUniverseMark

  return (
    <div data-theme={hint === "silicon-brick-road" ? "sbr" : hint === "atlas-core" ? "atlas-core" : undefined} className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
      <div className="max-w-md w-full flex flex-col items-center gap-5">
        <Mark className="h-14 w-14 drop-shadow-lg" />
        <div className="w-full rounded-2xl card-lux p-6">
          <h2 className="font-display text-red-600 dark:text-red-400 font-semibold text-lg mb-2">Something went wrong</h2>
          {isDbError ? (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>The database connection failed. This usually means the environment variables are not set on Vercel.</p>
              <div className="bg-muted rounded-lg p-3 font-mono text-xs text-muted-foreground space-y-1">
                <p>DATABASE_URL=libsql://your-db.turso.io</p>
                <p>DATABASE_AUTH_TOKEN=your-token</p>
              </div>
              <p>Set these in your Vercel project settings under <span className="text-foreground font-medium">Settings → Environment Variables</span>, then redeploy.</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {error.message || "An unexpected error occurred."}
              {error.digest && (
                <span className="block mt-1 text-xs text-muted-foreground/70">Digest: {error.digest}</span>
              )}
            </p>
          )}
        </div>
        <button
          onClick={reset}
          className="w-full py-2.5 rounded-lg btn-brand text-sm font-semibold"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
