import { NextRequest, NextResponse } from "next/server"
import { jwtVerify } from "jose"

const SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? "atlas-core-secret-key-change-in-production"
)

const PUBLIC_PATHS = ["/forgot-password", "/reset-password"]

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // "/login" must be reached via the chooser at "/" — bounce any direct hit
  // lacking a valid ?portfolio= (bookmarks, PWA shortcuts, stale links) back
  // to the chooser instead of silently defaulting to Atlas Core.
  if (pathname === "/login") {
    const portfolio = req.nextUrl.searchParams.get("portfolio")
    if (portfolio !== "atlas-core" && portfolio !== "silicon-brick-road") {
      return NextResponse.redirect(new URL("/", req.url))
    }
    return NextResponse.next()
  }

  // Allow other public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Allow Next.js internals and static assets
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/") ||
    pathname.includes(".")
  ) {
    return NextResponse.next()
  }

  // "/" is the portfolio chooser for logged-out visitors (and the dashboard
  // for authenticated ones) — app/page.tsx branches on session itself, so the
  // proxy never gates it.
  if (pathname === "/") {
    return NextResponse.next()
  }

  // Verify JWT — not just presence but cryptographic validity
  const token = req.cookies.get("atlas_session")?.value
  if (!token) {
    return NextResponse.redirect(new URL("/", req.url))
  }

  try {
    await jwtVerify(token, SECRET)
  } catch {
    // Expired or tampered token — clear cookie and redirect
    const res = NextResponse.redirect(new URL("/", req.url))
    res.cookies.delete("atlas_session")
    return res
  }

  // Legacy utilities are consolidated into the current information architecture. Keep old
  // bookmarks working without exposing or maintaining a second application in parallel.
  const consolidated: Record<string, string> = {
    "/holdings": "/portfolio", "/trades": "/portfolio", "/contributions": "/portfolio",
    "/dividends": "/portfolio", "/rebalance": "/portfolio", "/history": "/portfolio", "/ytd": "/portfolio",
    "/calendar": "/governance", "/behaviour": "/governance",
    "/smart-money": "/reports", "/watchlist": "/reports", "/export": "/settings",
  }
  if (consolidated[pathname]) return NextResponse.redirect(new URL(consolidated[pathname], req.url))

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
