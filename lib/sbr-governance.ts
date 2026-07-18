import { SILICON_BRICK_ROAD as SBR } from "@/lib/constitutions"
import {
  computeSbrLookThrough, SBR_TECHNOLOGY_LIMIT, SBR_TECHNOLOGY_WATCH,
  SBR_SINGLE_COMPANY_LIMIT, SBR_SINGLE_COMPANY_WATCH, SBR_COUNTRY_LIMIT, SBR_COUNTRY_WATCH,
  SBR_SEMICONDUCTOR_LIMIT, SBR_SEMICONDUCTOR_WATCH, type SbrLookThrough,
} from "@/lib/sbr-look-through"
import type { SbrPosition } from "@/lib/sbr-engine"
import type { GovAlignment, Align } from "@/lib/governance-status"
import { evaluateFundLimits, evaluateCombinedSleeve, sleeveActuals, summarize } from "@/lib/governance-engine"

export function evaluateSbrGovernance(positions: SbrPosition[], totalValue: number, weightsAsOf?: Date, now = new Date(), computedLookThrough?:SbrLookThrough): GovAlignment {
  if (totalValue <= 0) return { checks: [], breaches: 0, watches: 0, overall: "ok" }
  const st = (breach: boolean, watch: boolean): Align => breach ? "breach" : watch ? "watch" : "ok"
  const actual = sleeveActuals(positions)
  const equity = (actual.get("VWRA") ?? 0) + (actual.get("EQAC") ?? 0) + (actual.get("SMH") ?? 0)
  const lt = computedLookThrough??computeSbrLookThrough(positions, now, weightsAsOf)
  // Per-fund hard cap / floor / soft-band and the combined EQAC+SMH ceiling are the shared
  // engine (lib/governance-engine.ts) — the exact same implementation Atlas's
  // evaluateGovernance uses, reading limits straight off SILICON_BRICK_ROAD.funds instead
  // of a hand-copied loop, so a boundary/threshold fix (e.g. this session's inclusive->=
  // fix, or the alias-consolidation fix) can never need a second edit in the Atlas file.
  const fundLimits = evaluateFundLimits(SBR.funds, positions)
  const checks: GovAlignment["checks"] = [
    { ...fundLimits, id: "holding-hard", label: "Allocation bands" },
    ...(SBR.combined ? [{ ...evaluateCombinedSleeve(SBR.combined, positions), id: "satellites", label: `EQAC + SMH stay below ${SBR.combined.hard}%` }] : []),
    { id: "company-lt", label: `No company reaches ${SBR_SINGLE_COMPANY_LIMIT}% look-through`, status: st(lt.topCompany.pct >= SBR_SINGLE_COMPANY_LIMIT, lt.topCompany.pct >= SBR_SINGLE_COMPANY_WATCH), detail: `${lt.topCompany.name} is ${lt.topCompany.pct.toFixed(1)}% (watch ${SBR_SINGLE_COMPANY_WATCH}%, review ${SBR_SINGLE_COMPANY_LIMIT}%)` },
    { id: "industry-lt", label: `Technology-related industries stay below ${SBR_TECHNOLOGY_LIMIT}%`, status: st(lt.technologyPct >= SBR_TECHNOLOGY_LIMIT, lt.technologyPct >= SBR_TECHNOLOGY_WATCH), detail: `${lt.technologyPct.toFixed(1)}% (watch ${SBR_TECHNOLOGY_WATCH}%, review ${SBR_TECHNOLOGY_LIMIT}%)` },
    { id: "semiconductor-lt", label: `Semiconductors stay below ${SBR_SEMICONDUCTOR_LIMIT}%`, status: st(lt.semiconductorPct >= SBR_SEMICONDUCTOR_LIMIT, lt.semiconductorPct >= SBR_SEMICONDUCTOR_WATCH), detail: `${lt.semiconductorPct.toFixed(1)}% (watch ${SBR_SEMICONDUCTOR_WATCH}%, review ${SBR_SEMICONDUCTOR_LIMIT}%)` },
    { id: "country-lt", label: `No country reaches ${SBR_COUNTRY_LIMIT}%`, status: st(lt.topCountry.pct >= SBR_COUNTRY_LIMIT, lt.topCountry.pct >= SBR_COUNTRY_WATCH), detail: `${lt.topCountry.name} is ${lt.topCountry.pct.toFixed(1)}% (watch ${SBR_COUNTRY_WATCH}%, review ${SBR_COUNTRY_LIMIT}%)` },
    { id: "asset", label: "Equity remains within the high-risk mandate", status: st(equity > (SBR.totalEquityMaxPct ?? 100), equity > (SBR.totalEquityMaxPct ?? 100) - 2), detail: `Equity ${equity.toFixed(1)}%; managed futures ${(actual.get("DBMFE") ?? 0).toFixed(1)}%` },
    { id: "freshness", label: "Underlying fund data is current", status: st(lt.stale, lt.freshness === "review"), detail: `Oldest required look-through source is ${lt.ageDays} days old` },
  ]
  return { checks, ...summarize(checks) }
}
