import Link from "next/link"
import { AtlasCoreMark, SbrMark, AtlasUniverseMark } from "@/components/brand/brand-mark"

// Unauthenticated home page: the front door to the Atlas Universe. Each card is
// self-themed via inline CSS custom properties (--brand-a/b/c, --primary) rather
// than the data-theme attribute, so two different brand hues can render side by
// side without triggering the global aurora background (which is fixed-position
// and would otherwise paint one full-viewport wash behind both cards).
const PANELS = [
  {
    id: "atlas-core",
    name: "Atlas Core",
    tagline: "Global Diversified Equity · to 2045",
    Mark: AtlasCoreMark,
    vars: { "--brand-a": "262 83% 58%", "--brand-b": "271 91% 65%", "--brand-c": "292 84% 61%", "--primary": "262 83% 56%" },
  },
  {
    id: "silicon-brick-road",
    name: "Silicon Brick Road",
    tagline: "Saving toward your HDB deposit",
    Mark: SbrMark,
    vars: { "--brand-a": "199 95% 46%", "--brand-b": "221 88% 55%", "--brand-c": "189 94% 40%", "--primary": "212 92% 48%" },
  },
] as const

export function PortfolioChooser() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-10 flex flex-col items-center">
          <AtlasUniverseMark className="h-16 w-16 drop-shadow-lg mb-5" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-600/70 dark:text-amber-400/60 mb-3">Atlas Universe</p>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight gradient-text-universe pb-1.5">
            Two constitutions. One discipline.
          </h1>
          <p className="text-sm text-muted-foreground mt-3 max-w-md mx-auto leading-relaxed">
            Select the portfolio you hold to sign in. Each is governed by its own written
            constitution, enforced consistently and without discretion.
          </p>
        </div>

        <div className="relative">
          {/* Connecting emblem — visible at sm+, sits between the two cards to make the
              "one discipline" claim literal rather than just stated in copy. */}
          <div
            className="hidden sm:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 h-12 w-12 items-center justify-center rounded-full bg-background shadow-md"
            aria-hidden="true"
          >
            <AtlasUniverseMark className="h-11 w-11" />
          </div>

          <div className="grid gap-5 sm:grid-cols-2 reveal-stack">
            {PANELS.map(({ id, name, tagline, Mark, vars }) => (
              <Link
                key={id}
                href={`/login?portfolio=${id}`}
                className="group relative rounded-3xl card-lux ring-hero overflow-hidden p-8 flex flex-col items-center text-center gap-3 transition-transform hover:-translate-y-1"
                style={vars as React.CSSProperties}
              >
                <Mark className="h-20 w-20 drop-shadow-lg transition-transform duration-300 group-hover:scale-105 motion-reduce:transform-none" />
                <div>
                  <p className="font-display text-lg font-semibold tracking-tight">{name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{tagline}</p>
                </div>
                <span className="mt-1 text-xs font-semibold text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                  Sign in →
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
