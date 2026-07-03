import { ArrowRight, Zap, AlertTriangle, ShieldAlert, TrendingUp, CheckCircle2 } from "lucide-react"
import type { NextMove } from "@/lib/next-best-move"
import { MarkDoneButton } from "@/components/dashboard/mark-done-button"

const SEVERITY_CONFIG = {
  critical: {
    Icon: ShieldAlert,
    ring: "border-red-500/50",
    bg: "bg-red-500/[0.08] dark:bg-red-500/[0.10]",
    glow: "glow-red",
    iconBg: "bg-red-500/20",
    iconColor: "text-red-500",
    label: "Do this first",
    labelColor: "text-red-600 dark:text-red-400",
  },
  high: {
    Icon: AlertTriangle,
    ring: "border-amber-500/50",
    bg: "bg-amber-500/[0.07] dark:bg-amber-500/[0.09]",
    glow: "glow-amber",
    iconBg: "bg-amber-500/20",
    iconColor: "text-amber-500",
    label: "Your next move",
    labelColor: "text-amber-700 dark:text-amber-400",
  },
  medium: {
    Icon: Zap,
    ring: "border-violet-500/40",
    bg: "bg-violet-500/[0.06]",
    glow: "",
    iconBg: "bg-violet-500/20",
    iconColor: "text-violet-500",
    label: "Your next move",
    labelColor: "text-violet-700 dark:text-violet-400",
  },
  low: {
    Icon: TrendingUp,
    ring: "border-blue-500/40",
    bg: "bg-blue-500/[0.05]",
    glow: "",
    iconBg: "bg-blue-500/20",
    iconColor: "text-blue-500",
    label: "Your next move",
    labelColor: "text-blue-700 dark:text-blue-400",
  },
  none: {
    Icon: CheckCircle2,
    ring: "border-green-500/40",
    bg: "bg-green-500/[0.05]",
    glow: "",
    iconBg: "bg-green-500/20",
    iconColor: "text-green-500",
    label: "You're on track",
    labelColor: "text-green-700 dark:text-green-400",
  },
} as const

export function NextBestMove({ move, dataAsOf, stale, lastDone }: { move: NextMove; dataAsOf?: string; stale?: boolean; lastDone?: { note: string; date: string } | null }) {
  const cfg = SEVERITY_CONFIG[move.severity]
  const { Icon } = cfg
  const asOfLabel = dataAsOf
    ? new Date(dataAsOf).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : null
  const lastDoneLabel = lastDone
    ? new Date(lastDone.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : null

  return (
    <div className={`rounded-2xl border-2 ${cfg.ring} ${cfg.bg} ${cfg.glow} overflow-hidden`}>
      <div className="px-5 pt-4 pb-2 flex items-center gap-2">
        <span className={`text-[11px] font-black uppercase tracking-widest ${cfg.labelColor}`}>
          {cfg.label}
        </span>
        <div className="h-px flex-1 bg-current opacity-10" />
        <span className="text-[10px] font-semibold text-muted-foreground px-2 py-0.5 rounded-full bg-background/60">
          {move.ticker}
        </span>
      </div>

      <div className="px-5 pb-5">
        <div className="flex items-start gap-4">
          <div className={`shrink-0 flex h-12 w-12 items-center justify-center rounded-xl ${cfg.iconBg}`}>
            <Icon className={`h-6 w-6 ${cfg.iconColor}`} />
          </div>
          <div className="flex-1 min-w-0">
            {/* The headline action — big and unambiguous */}
            <h2 className="text-xl font-black tracking-tight leading-tight mb-2">
              {move.action}
            </h2>

            {/* What to do */}
            <div className="space-y-2.5">
              <div className="flex gap-2">
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground mt-0.5 w-10">Do</span>
                <p className="text-sm text-foreground leading-relaxed">{move.what}</p>
              </div>
              <div className="flex gap-2">
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground mt-0.5 w-10">Why</span>
                <p className="text-sm text-muted-foreground leading-relaxed">{move.why}</p>
              </div>
              <div className="flex gap-2">
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground mt-0.5 w-10">When</span>
                <p className="text-sm text-muted-foreground leading-relaxed">{move.when}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <MarkDoneButton action={move.action} />
            <a
              href="/command-centre"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-500 hover:text-violet-400 transition-colors"
            >
              Full plan
              <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
          {asOfLabel && (
            <span className="text-[10px] text-muted-foreground">
              {stale ? (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">⚠ verified figures</span>
              ) : (
                <>live data · {asOfLabel}</>
              )}
            </span>
          )}
        </div>

        {lastDoneLabel && (
          <p className="mt-2 text-[11px] text-muted-foreground border-t border-border/60 pt-2">
            <CheckCircle2 className="inline h-3 w-3 text-green-500 mr-1 -mt-0.5" />
            Last action you logged: <span className="font-medium text-foreground">{lastDone!.note}</span> · {lastDoneLabel}
          </p>
        )}
      </div>
    </div>
  )
}
