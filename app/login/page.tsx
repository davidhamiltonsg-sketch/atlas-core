"use client"

import { Suspense, useState, useTransition } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { loginAction } from "./actions"
import { AtlasCoreMark, SbrMark } from "@/components/brand/brand-mark"
import { SpinningMark, SPIN_THEME } from "@/components/brand/spinning-mark"
import { Lock } from "lucide-react"
import type { ConstitutionId } from "@/lib/constitutions"

const PORTFOLIO_MARK = { "atlas-core": AtlasCoreMark, "silicon-brick-road": SbrMark } as const

const PORTFOLIO_META: Record<ConstitutionId, { theme: string; name: string; version: string; placeholder: string; footer: string }> = {
  "atlas-core": {
    theme: "atlas-core",
    name: "Atlas Core",
    version: "v1.5 · GDEA · Sign in to continue",
    placeholder: "admin@atlas.local",
    footer: "Atlas Core is a private investment dashboard. Access is restricted.",
  },
  "silicon-brick-road": {
    theme: "sbr",
    name: "Silicon Brick Road",
    version: "v2.2 · SBR · Sign in to continue",
    placeholder: "you@example.com",
    footer: "Silicon Brick Road is a private savings dashboard. Access is restricted.",
  },
}

function LoginForm() {
  const searchParams = useSearchParams()
  const portfolio: ConstitutionId = searchParams.get("portfolio") === "silicon-brick-road" ? "silicon-brick-road" : "atlas-core"
  const meta = PORTFOLIO_META[portfolio]

  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await loginAction(formData)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <div data-theme={meta.theme} className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <SpinningMark
            Mark={PORTFOLIO_MARK[portfolio]}
            conic={SPIN_THEME[portfolio].conic}
            glowShadow={SPIN_THEME[portfolio].glow}
            size="h-16 w-16"
            ringInset="-inset-3"
            className="mb-4"
          />
          <h1 className="font-display text-xl font-semibold tracking-tight">{meta.name}</h1>
          <p className="text-xs text-muted-foreground mt-1">{meta.version}</p>
        </div>

        {/* Form */}
        <div className="rounded-2xl card-lux p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Email
              </label>
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                placeholder={meta.placeholder}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Password
              </label>
              <input
                type="password"
                name="password"
                required
                autoComplete="current-password"
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 px-3 py-2.5 text-xs text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isPending}
              className="w-full flex items-center justify-center gap-2 rounded-lg btn-brand disabled:opacity-60 text-sm font-semibold py-2.5"
            >
              <Lock className="h-3.5 w-3.5" />
              {isPending ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <div className="flex justify-center mt-5">
          <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Forgot password?
          </Link>
        </div>

        <p className="text-center text-[11px] text-muted-foreground mt-4">
          {meta.footer}
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <LoginForm />
    </Suspense>
  )
}
