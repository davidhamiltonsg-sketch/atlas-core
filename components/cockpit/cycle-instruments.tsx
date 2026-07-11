import type { BtcPhaseCard, SmhBuyZone, CombinedTechCeiling, SgovQueueState } from "@/lib/cycle"
import { displayTicker } from "@/lib/approved-alternatives"

interface Props {
  btc: BtcPhaseCard
  smh: SmhBuyZone
  tech: CombinedTechCeiling
  sgov: SgovQueueState
}

/** A single instrument tile — used for each of the 4 cycle cards. */
function InstrumentTile({
  title, citation, badge, badgeColor, stat, statColor, sub, note,
}: {
  title: string
  citation: string
  badge: string
  badgeColor: string
  stat: string
  statColor: string
  sub: string
  note?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{citation}</p>
          <p className="text-xs font-semibold mt-0.5">{title}</p>
        </div>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${badgeColor}`}>{badge}</span>
      </div>
      <div className="mt-1">
        <p className={`font-data text-2xl font-black tabular-nums leading-none ${statColor}`}>{stat}</p>
        <p className="font-data text-[11px] text-muted-foreground mt-1">{sub}</p>
      </div>
      {note && <p className="font-data text-[10px] text-muted-foreground/70 leading-relaxed border-t border-border pt-2 mt-1">{note}</p>}
    </div>
  )
}

/** Cycle Instruments panel — 4 cards: BTC phase, SMH zone, combined tech, SGOV queue. */
export function CycleInstruments({ btc, smh, tech, sgov }: Props) {
  const btcBadgeColor =
    btc.phase === "post_halving_bull" ? "border-green-500/40 text-green-600 dark:text-green-400" :
    btc.phase === "bear"              ? "border-red-500/40 text-red-600 dark:text-red-400" :
    "border-amber-500/40 text-amber-600 dark:text-amber-400"

  const smhBadgeColor =
    smh.isBuyWindow && !smh.isSkipRule ? "border-green-500/40 text-green-600 dark:text-green-400" :
    smh.isSkipRule                     ? "border-amber-500/40 text-amber-600 dark:text-amber-400" :
    "border-muted-foreground/30 text-muted-foreground"

  const techBadgeColor =
    tech.status === "clear"       ? "border-green-500/40 text-green-600 dark:text-green-400" :
    tech.status === "soft_breach" ? "border-amber-500/40 text-amber-600 dark:text-amber-400" :
    "border-red-500/40 text-red-600 dark:text-red-400"

  const sgovBadgeColor = sgov.isAtFloor
    ? "border-green-500/40 text-green-600 dark:text-green-400"
    : "border-amber-500/40 text-amber-600 dark:text-amber-400"

  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Cycle Instruments</p>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <InstrumentTile
          title="BTC Phase"
          citation="Art. X"
          badge={btc.label}
          badgeColor={btcBadgeColor}
          stat={`${btc.target}%`}
          statColor={btc.phase === "post_halving_bull" ? "text-green-500" : btc.phase === "bear" ? "text-red-500" : "text-amber-500"}
          sub={`Target · cap ${btc.hardCap}% · soft ${btc.softHigh}%`}
          note={btc.daysUntilBullEnd !== null ? `Bull window ends in ${btc.daysUntilBullEnd}d` : `${btc.monthsSinceHalving}mo post-halving`}
        />
        <InstrumentTile
          title={`${displayTicker("SMH")} Buy Zone`}
          citation="Art. XI · B1"
          badge={smh.isSkipRule ? "SKIP RULE" : smh.isBuyWindow ? "BUY ZONE" : "NEAR TOP"}
          badgeColor={smhBadgeColor}
          stat={`${(smh.pctFromHigh * 100).toFixed(1)}%`}
          statColor={smh.isSkipRule ? "text-amber-500" : smh.isBuyWindow ? "text-green-500" : "text-red-500"}
          sub={`vs 52w high · ${smh.label}`}
          note={smh.isSkipRule ? `Step 7 redirects to ${displayTicker("VT")}` : smh.pctToHigh > 0 ? `+${(smh.pctToHigh * 100).toFixed(1)}% to reach high` : undefined}
        />
        <InstrumentTile
          title="Combined Tech"
          citation="Art. XII"
          badge={tech.status === "clear" ? "CLEAR" : tech.status === "soft_breach" ? "SOFT ⚠" : "HARD ⛔"}
          badgeColor={techBadgeColor}
          stat={`${tech.combinedPct.toFixed(1)}%`}
          statColor={tech.status === "clear" ? "text-green-500" : tech.status === "soft_breach" ? "text-amber-500" : "text-red-500"}
          sub={`${displayTicker("QQQM")} ${tech.qqqmPct.toFixed(1)}% + ${displayTicker("SMH")} ${tech.smhPct.toFixed(1)}%`}
          note={tech.headroom >= 0 ? `${tech.headroom.toFixed(1)}% below soft ceiling (${tech.softCeiling}%)` : `${Math.abs(tech.headroom).toFixed(1)}% over hard ceiling`}
        />
        <InstrumentTile
          title="SGOV Buffer"
          citation="Art. XIII"
          badge={sgov.isAtFloor ? "AT FLOOR" : `${sgov.monthsToFloor ?? "?"}mo`}
          badgeColor={sgovBadgeColor}
          stat={`${sgov.currentPct.toFixed(1)}%`}
          statColor={sgov.isAtFloor ? "text-green-500" : "text-amber-500"}
          sub={`Floor ${sgov.floorPct}% · gap ${sgov.isAtFloor ? "0" : sgov.gapPct.toFixed(1)}%`}
          note={sgov.isAtFloor ? "Buffer adequate — no redirection needed" : `SGD ${Math.round(sgov.gapSgd).toLocaleString()} to fill`}
        />
      </div>
    </div>
  )
}
