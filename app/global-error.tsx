"use client"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const isDbError =
    error.message?.includes("DATABASE_URL") ||
    error.message?.includes("libsql") ||
    error.digest

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0f0f13", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif", padding: "24px" }}>
        <div style={{ maxWidth: 480, width: "100%" }}>
          <div style={{ border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)", borderRadius: 12, padding: 24, marginBottom: 16 }}>
            <h2 style={{ color: "#f87171", margin: "0 0 8px", fontSize: 18 }}>Application error</h2>
            {isDbError ? (
              <div style={{ color: "#d4d4d8", fontSize: 14, lineHeight: 1.6 }}>
                <p style={{ margin: "0 0 12px" }}>Database connection failed. Set these environment variables on Vercel:</p>
                <pre style={{ background: "#18181b", borderRadius: 8, padding: 12, fontSize: 12, color: "#a1a1aa", margin: "0 0 12px", overflow: "auto" }}>
                  DATABASE_URL=libsql://your-db.turso.io{"\n"}DATABASE_AUTH_TOKEN=your-token
                </pre>
                <p style={{ margin: 0 }}>Then redeploy your project.</p>
              </div>
            ) : (
              <p style={{ color: "#d4d4d8", fontSize: 14, margin: 0 }}>
                {error.message || "An unexpected error occurred."}
                {error.digest && <span style={{ display: "block", marginTop: 4, fontSize: 12, color: "#71717a" }}>Digest: {error.digest}</span>}
              </p>
            )}
          </div>
          <button
            onClick={reset}
            style={{ width: "100%", padding: "10px 0", borderRadius: 8, background: "#6366f1", color: "white", border: "none", fontSize: 14, fontWeight: 500, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
