"use client"

import { useEffect } from "react"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  const isDbError =
    error.message?.includes("DATABASE_URL") ||
    error.message?.includes("libsql") ||
    error.message?.includes("prisma") ||
    error.digest

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f0f13] p-6">
      <div className="max-w-md w-full space-y-4">
        <div className="border border-red-500/30 bg-red-500/10 rounded-xl p-6">
          <h2 className="text-red-400 font-semibold text-lg mb-2">Something went wrong</h2>
          {isDbError ? (
            <div className="space-y-3 text-sm text-zinc-300">
              <p>The database connection failed. This usually means the environment variables are not set on Vercel.</p>
              <div className="bg-zinc-900 rounded-lg p-3 font-mono text-xs text-zinc-400 space-y-1">
                <p>DATABASE_URL=libsql://your-db.turso.io</p>
                <p>DATABASE_AUTH_TOKEN=your-token</p>
              </div>
              <p>Set these in your Vercel project settings under <span className="text-zinc-100">Settings → Environment Variables</span>, then redeploy.</p>
            </div>
          ) : (
            <p className="text-sm text-zinc-300">
              {error.message || "An unexpected error occurred."}
              {error.digest && (
                <span className="block mt-1 text-xs text-zinc-500">Digest: {error.digest}</span>
              )}
            </p>
          )}
        </div>
        <button
          onClick={reset}
          className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
