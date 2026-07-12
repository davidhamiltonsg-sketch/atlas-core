"use client"

import { useState, useTransition } from "react"
import { Users, Plus, Trash2, Check, AlertCircle, Loader2, ShieldCheck, User, RefreshCw } from "lucide-react"
import { createUserAction, deleteUserAction } from "./actions"

interface UserRow {
  id: string
  email: string
  name: string
  role: string
  createdAt: string
  holdingCount: number
}

interface AdminUsersClientProps {
  users: UserRow[]
  currentUserId: string
}

export function AdminUsersClient({ users: initialUsers, currentUserId }: AdminUsersClientProps) {
  const [users, setUsers] = useState(initialUsers)
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formSuccess, setFormSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [provisionState, setProvisionState] = useState<"idle" | "pending" | "ok" | "err">("idle")
  const [provisionMsg, setProvisionMsg] = useState<string | null>(null)

  async function handleProvisionSbr() {
    if (!confirm("Refresh Dami's SBR account configuration? Existing holdings and contribution settings will be preserved; the login secret is refreshed from dami_key.")) return
    setProvisionState("pending")
    setProvisionMsg(null)
    try {
      const res = await fetch("/api/admin/provision-dami", { method: "POST" })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setProvisionState("err")
        setProvisionMsg(data.error ?? "Provision failed")
      } else {
        setProvisionState("ok")
        setProvisionMsg(`Done — ${data.holdings} holdings created for ${data.email}`)
        setTimeout(() => { setProvisionState("idle"); setProvisionMsg(null); window.location.reload() }, 3000)
      }
    } catch {
      setProvisionState("err")
      setProvisionMsg("Network error — check console")
    }
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    const formData = new FormData(e.currentTarget)
    const form = e.currentTarget

    startTransition(async () => {
      const result = await createUserAction(formData)
      if (result.error) {
        setFormError(result.error)
      } else {
        setFormSuccess(true)
        form.reset()
        setTimeout(() => {
          setFormSuccess(false)
          setShowForm(false)
          window.location.reload()
        }, 1200)
      }
    })
  }

  function handleDelete(userId: string) {
    if (!confirm("Are you sure you want to delete this user and all their portfolio data?")) return
    setDeletingId(userId)
    startTransition(async () => {
      await deleteUserAction(userId)
      setUsers((prev) => prev.filter((u) => u.id !== userId))
      setDeletingId(null)
    })
  }

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Users</p>
          <p className="mt-1 text-xl font-semibold">{users.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Admin Users</p>
          <p className="mt-1 text-xl font-semibold">{users.filter((u) => u.role === "admin").length}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Standard Users</p>
          <p className="mt-1 text-xl font-semibold">{users.filter((u) => u.role !== "admin").length}</p>
        </div>
      </div>

      {/* User list */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Users</h2>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 text-xs font-semibold transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New User
          </button>
        </div>

        {/* Create form */}
        {showForm && (
          <form onSubmit={handleCreate} className="p-5 border-b border-border bg-accent/20">
            <p className="text-xs font-semibold mb-4">Create New User</p>
            <div className="grid sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Full Name</label>
                <input
                  name="name"
                  required
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
                  placeholder="Jane Smith"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Email</label>
                <input
                  name="email"
                  type="email"
                  required
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
                  placeholder="jane@example.com"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Password</label>
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
                  placeholder="Min. 8 characters"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Role</label>
                <select
                  name="role"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
                >
                  <option value="user">Standard User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            {formError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 px-3 py-2 mb-3 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {formError}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={isPending || formSuccess}
                className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 transition-colors"
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : formSuccess ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                {formSuccess ? "Created!" : "Create User"}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setFormError(null) }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* User rows */}
        <div className="divide-y divide-border">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between px-5 py-4 hover:bg-accent/20 transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${u.role === "admin" ? "bg-violet-50 dark:bg-violet-500/10" : "bg-muted"}`}>
                  {u.role === "admin"
                    ? <ShieldCheck className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                    : <User className="h-4 w-4 text-muted-foreground" />
                  }
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{u.name}</p>
                    {u.id === currentUserId && (
                      <span className="text-[10px] bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 rounded-full font-medium">you</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                </div>
              </div>

              <div className="flex items-center gap-4 shrink-0 ml-4">
                <div className="hidden sm:block text-right">
                  <p className="text-xs font-medium capitalize">{u.role}</p>
                  <p className="text-[11px] text-muted-foreground">{u.holdingCount} holdings</p>
                </div>
                <div className="hidden sm:block text-right">
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(u.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
                {u.id !== currentUserId && (
                  <button
                    onClick={() => handleDelete(u.id)}
                    disabled={deletingId === u.id}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50"
                    title="Delete user"
                  >
                    {deletingId === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card/50 p-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">New users</span> are created with the same portfolio structure (ETF holdings) as the admin account, with zero positions. Each user independently updates their own portfolio values and has isolated data. Admin users can access this management page.
        </p>
      </div>

      {/* SBR re-provision */}
      <div className="rounded-xl border border-border bg-card p-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold mb-0.5">Silicon Brick Road — Re-provision Dami</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Preserves Dami&apos;s existing holdings and editable contribution settings, ensures VWRA / EQAC / SMH / Bitcoin / DBMFE are configured, and refreshes the password from the <code className="text-[11px] bg-muted px-1 py-0.5 rounded">dami_key</code> environment variable.
          </p>
          {provisionMsg && (
            <p className={`mt-2 text-xs font-medium ${provisionState === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {provisionMsg}
            </p>
          )}
        </div>
        <button
          onClick={handleProvisionSbr}
          disabled={provisionState === "pending" || provisionState === "ok"}
          className="shrink-0 flex items-center gap-1.5 rounded-lg border border-border hover:border-violet-500 hover:text-violet-600 dark:hover:text-violet-400 text-muted-foreground px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
        >
          {provisionState === "pending" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : provisionState === "ok" ? <Check className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {provisionState === "ok" ? "Done" : "Re-provision SBR"}
        </button>
      </div>
    </div>
  )
}
