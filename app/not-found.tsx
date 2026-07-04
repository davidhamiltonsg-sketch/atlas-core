import Link from "next/link"
import { AtlasCoreMark, SbrMark, AtlasUniverseMark } from "@/components/brand/brand-mark"
import { getPortfolioHint } from "@/lib/session"

// Branded 404 — reads the same non-auth portfolio_hint cookie as app/loading.tsx, so a
// signed-in user sees their own crest and a logged-out (or just-logged-out) visitor sees
// the neutral Atlas Universe mark, never a guess at which portfolio they belong to.
export default async function NotFound() {
  const hint = await getPortfolioHint()
  const known = hint === "atlas-core" || hint === "silicon-brick-road"
  const Mark = hint === "silicon-brick-road" ? SbrMark : hint === "atlas-core" ? AtlasCoreMark : AtlasUniverseMark

  return (
    <div data-theme={hint === "silicon-brick-road" ? "sbr" : hint === "atlas-core" ? "atlas-core" : undefined} className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center flex flex-col items-center">
        <Mark className="h-16 w-16 drop-shadow-lg mb-6" />
        <p className={`font-display text-6xl font-semibold tracking-tight mb-2 ${known ? "gradient-text" : "gradient-text-universe"} pb-1`}>404</p>
        <h1 className="font-display text-xl font-semibold tracking-tight mb-2">Page not found</h1>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>
        <Link href="/" className="rounded-lg btn-brand text-sm font-semibold px-5 py-2.5">
          Back to safety
        </Link>
      </div>
    </div>
  )
}
