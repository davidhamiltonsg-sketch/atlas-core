"use client"

import { useState, useTransition } from "react"
import { Check, AlertCircle, Loader2, User, Lock, Shield, Eye, EyeOff, TrendingUp } from "lucide-react"
import { updateProfileAction, changePasswordAction, updateContributionSettingsAction } from "./actions"

interface SettingsClientProps {
  initialName: string
  initialEmail: string
  role: string
  monthlyContribution: number
  annualLumpSum: number
  contributionGrowthRate: number
  riskFreeRate: number
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-xl card-lux overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function StatusMessage({ msg }: { msg: { type: "success" | "error"; text: string } | null }) {
  if (!msg) return null
  return (
    <div className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs ${
      msg.type === "success"
        ? "bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 text-green-700 dark:text-green-400"
        : "bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400"
    }`}>
      {msg.type === "success" ? <Check className="h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
      {msg.text}
    </div>
  )
}

export function SettingsClient({ initialName, initialEmail, role, monthlyContribution, annualLumpSum, contributionGrowthRate, riskFreeRate }: SettingsClientProps) {
  // Profile
  const [name, setName] = useState(initialName)
  const [email, setEmail] = useState(initialEmail)
  const [profileMsg, setProfileMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [profilePending, startProfileTransition] = useTransition()

  // Password
  const [showPwd, setShowPwd] = useState(false)
  const [pwdMsg, setPwdMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [pwdPending, startPwdTransition] = useTransition()

  // Contribution settings
  const [contribMsg, setContribMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [contribPending, startContribTransition] = useTransition()

  function handleContrib(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setContribMsg(null)
    const formData = new FormData(e.currentTarget)
    startContribTransition(async () => {
      const result = await updateContributionSettingsAction(formData)
      setContribMsg(result.success
        ? { type: "success", text: "Contribution settings saved." }
        : { type: "error", text: result.error ?? "Save failed." }
      )
    })
  }

  function handleProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setProfileMsg(null)
    const formData = new FormData(e.currentTarget)
    startProfileTransition(async () => {
      const result = await updateProfileAction(formData)
      setProfileMsg(result.success
        ? { type: "success", text: "Profile updated." }
        : { type: "error", text: result.error ?? "Update failed." }
      )
    })
  }

  function handlePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPwdMsg(null)
    const formData = new FormData(e.currentTarget)
    const form = e.currentTarget
    startPwdTransition(async () => {
      const result = await changePasswordAction(formData)
      if (result.success) {
        setPwdMsg({ type: "success", text: "Password changed." })
        form.reset()
      } else {
        setPwdMsg({ type: "error", text: result.error ?? "Change failed." })
      }
    })
  }

  return (
    <div className="max-w-xl space-y-5">
      {/* Contribution Settings */}
      <Section title="Contribution Settings" icon={TrendingUp}>
        <form onSubmit={handleContrib} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Monthly Contribution (USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <input
                  name="monthlyContribution"
                  type="number"
                  step="100"
                  min="0"
                  required
                  defaultValue={monthlyContribution}
                  className="w-full rounded-lg border border-border bg-background pl-7 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Used in the execution plan and forecast.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Annual Lump Sum (USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <input
                  name="annualLumpSum"
                  type="number"
                  step="1000"
                  min="0"
                  required
                  defaultValue={annualLumpSum}
                  className="w-full rounded-lg border border-border bg-background pl-7 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Yearly bonus contribution for the forecast.</p>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Contribution Growth Rate (per year)</label>
            <div className="relative">
              <input
                name="contributionGrowthRate"
                type="number"
                step="0.01"
                min="0"
                max="1"
                required
                defaultValue={contributionGrowthRate}
                className="w-full rounded-lg border border-border bg-background px-3 pr-8 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">× p.a.</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">e.g. 0.05 = 5% annual growth in contributions. Used in the forecast model.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Risk-Free Rate (Sharpe baseline)</label>
            <div className="relative">
              <input
                name="riskFreeRate"
                type="number"
                step="0.001"
                min="0"
                max="1"
                required
                defaultValue={riskFreeRate}
                className="w-full rounded-lg border border-border bg-background px-3 pr-8 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">p.a.</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">e.g. 0.04 = 4% (current MAS T-bill proxy). Drives the Sharpe ratio on the Risk page.</p>
          </div>
          <StatusMessage msg={contribMsg} />
          <button
            type="submit"
            disabled={contribPending}
            className="flex items-center gap-1.5 rounded-lg btn-brand disabled:opacity-60 text-xs font-semibold px-4 py-2"
          >
            {contribPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save Contribution Settings
          </button>
        </form>
      </Section>

      {/* Profile */}
      <Section title="Profile" icon={User}>
        <form onSubmit={handleProfile} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Display Name</label>
            <input
              name="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Email Address</label>
            <input
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
            />
            <p className="text-[11px] text-muted-foreground mt-1">Used for password reset emails.</p>
          </div>
          <StatusMessage msg={profileMsg} />
          <button
            type="submit"
            disabled={profilePending}
            className="flex items-center gap-1.5 rounded-lg btn-brand disabled:opacity-60 text-xs font-semibold px-4 py-2"
          >
            {profilePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save Profile
          </button>
        </form>
      </Section>

      {/* Password */}
      <Section title="Change Password" icon={Lock}>
        <form onSubmit={handlePassword} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Current Password</label>
            <div className="relative">
              <input
                name="current"
                type={showPwd ? "text" : "password"}
                required
                autoComplete="current-password"
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 pr-10 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                placeholder="••••••••"
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
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">New Password</label>
            <input
              name="new"
              type={showPwd ? "text" : "password"}
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              placeholder="Min. 8 characters"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Confirm New Password</label>
            <input
              name="confirm"
              type={showPwd ? "text" : "password"}
              required
              autoComplete="new-password"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              placeholder="Repeat new password"
            />
          </div>
          <StatusMessage msg={pwdMsg} />
          <button
            type="submit"
            disabled={pwdPending}
            className="flex items-center gap-1.5 rounded-lg btn-brand disabled:opacity-60 text-xs font-semibold px-4 py-2"
          >
            {pwdPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
            Change Password
          </button>
        </form>
      </Section>

      {/* Account info */}
      <Section title="Account" icon={Shield}>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-1">
            <span className="text-xs text-muted-foreground">Role</span>
            <span className={`text-xs font-semibold capitalize px-2 py-0.5 rounded-full ${
              role === "admin"
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            }`}>
              {role}
            </span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-xs text-muted-foreground">Session</span>
            <span className="text-xs text-muted-foreground">7-day JWT · HttpOnly cookie</span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-xs text-muted-foreground">Password reset</span>
            <span className="text-xs text-muted-foreground">Email link · 1-hour expiry</span>
          </div>
        </div>
      </Section>
    </div>
  )
}
