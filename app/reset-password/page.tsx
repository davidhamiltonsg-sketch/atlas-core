"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { resetPasswordAction } from "./actions"
import { Lock, Eye, EyeOff } from "lucide-react"

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token") ?? ""

  const [error, setError] = useState<string | null>(null)
  const [showPwd, setShowPwd] = useState(false)
  const [isPending, startTransition] = useTransition()

  if (!token) {
    return (
      <div className="text-center">
        <p className="text-sm text-muted-foreground">Invalid reset link. Please request a new one.</p>
        <Link href="/forgot-password" className="mt-3 inline-block text-xs text-violet-600 dark:text-violet-400 underline">
          Request new link
        </Link>
      </div>
    )
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    formData.set("token", token)
    startTransition(async () => {
      const result = await resetPasswordAction(formData)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">New Password</label>
        <div className="relative">
          <input
            type={showPwd ? "text" : "password"}
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 pr-10 text-sm outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
            placeholder="Min. 8 characters"
          />
          <button
            type="button"
            onClick={() => setShowPwd(!showPwd)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">Confirm New Password</label>
        <input
          type={showPwd ? "text" : "password"}
          name="confirm"
          required
          autoComplete="new-password"
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
          placeholder="Repeat password"
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
        className="w-full flex items-center justify-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold py-2.5 transition-colors"
      >
        <Lock className="h-3.5 w-3.5" />
        {isPending ? "Saving…" : "Set new password"}
      </button>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-violet-600 shadow-lg shadow-violet-500/30 mb-4">
            <span className="text-sm font-black text-white tracking-tight">AC</span>
            <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/20" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Set new password</h1>
          <p className="text-xs text-muted-foreground mt-1">Choose a strong password for your account</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <Suspense fallback={<div className="text-xs text-muted-foreground">Loading…</div>}>
            <ResetPasswordForm />
          </Suspense>
        </div>

        <div className="flex justify-center mt-5">
          <Link href="/login" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
