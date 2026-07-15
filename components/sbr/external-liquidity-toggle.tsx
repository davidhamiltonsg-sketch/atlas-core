"use client"

import { useState, useTransition } from "react"
import { LifeBuoy, Check, AlertCircle, Loader2 } from "lucide-react"
import { setExternalLiquidityVerifiedAction } from "@/app/settings/sbr-liquidity-action"

interface ExternalLiquidityToggleProps {
  verified: boolean
  canEdit: boolean
}

/** Plain-English SBR confirmation: "my emergency money lives outside this portfolio".
 *  Feeds the health score's liquidity pillar — nothing here ever touches the holdings. */
export function ExternalLiquidityToggle({ verified, canEdit }: ExternalLiquidityToggleProps) {
  const [checked, setChecked] = useState(verified)
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function handleChange(next: boolean) {
    if (!canEdit || pending) return
    setChecked(next)
    setMsg(null)
    startTransition(async () => {
      const result = await setExternalLiquidityVerifiedAction(next)
      if (result.success) {
        setMsg({ type: "success", text: next ? "Thanks — your safety net is noted." : "Noted — the health score will flag this until it's confirmed again." })
      } else {
        setChecked(!next) // roll back
        setMsg({ type: "error", text: result.error ?? "Could not save the change." })
      }
    })
  }

  return (
    <div className="rounded-xl card-lux overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
        <LifeBuoy className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Your safety net</h2>
      </div>
      <div className="p-5 space-y-3">
        <p className="text-xs text-muted-foreground">
          This portfolio is for growing money you will not need soon. Your emergency money — the cash you
          could reach within days — should live somewhere else, like a savings account. Confirm that here
          so your plan&apos;s health score can reflect it.
        </p>
        <label className={`flex items-start gap-3 rounded-lg border border-border p-3 ${canEdit ? "cursor-pointer hover:bg-accent/40" : "opacity-70"} transition-colors`}>
          <input
            type="checkbox"
            checked={checked}
            disabled={!canEdit || pending}
            onChange={(e) => handleChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span className="text-xs">
            <span className="font-semibold">I confirm my emergency fund outside this portfolio is funded.</span>
            <span className="block text-muted-foreground mt-0.5">
              You can untick this at any time — for example after using the fund — and the health score will remind you to rebuild it.
            </span>
          </span>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0 mt-0.5" />}
        </label>
        {msg && (
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs ${
            msg.type === "success"
              ? "bg-success/10 border border-success/20 text-success"
              : "bg-danger/10 border border-danger/20 text-danger"
          }`}>
            {msg.type === "success" ? <Check className="h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
            {msg.text}
          </div>
        )}
        {!canEdit && <p className="text-[11px] text-muted-foreground">Only the portfolio owner or an administrator can change this.</p>}
      </div>
    </div>
  )
}
