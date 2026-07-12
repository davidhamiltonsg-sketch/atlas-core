import { SILICON_BRICK_ROAD as SBR } from "@/lib/constitutions"
import {
  computeSbrLookThrough, SBR_TECHNOLOGY_LIMIT, SBR_TECHNOLOGY_WATCH,
  SBR_SINGLE_COMPANY_LIMIT, SBR_SINGLE_COMPANY_WATCH, SBR_COUNTRY_LIMIT, SBR_COUNTRY_WATCH,
  SBR_SEMICONDUCTOR_LIMIT, SBR_SEMICONDUCTOR_WATCH,
} from "@/lib/sbr-look-through"
import type { SbrPosition } from "@/lib/sbr-engine"
import type { GovAlignment, Align } from "@/lib/governance-status"

export function evaluateSbrGovernance(positions: SbrPosition[], totalValue: number): GovAlignment {
  if (totalValue <= 0) return { checks: [], breaches: 0, watches: 0, overall: "ok" }
  const st = (breach: boolean, watch: boolean): Align => breach ? "breach" : watch ? "watch" : "ok"
  const actual = new Map(positions.map((p) => [p.ticker === "SMH.L" ? "SMH" : p.ticker, p.actualPct]))
  const combined = (actual.get("EQAC") ?? 0) + (actual.get("SMH") ?? 0)
  const equity = (actual.get("VWRA") ?? 0) + (actual.get("EQAC") ?? 0) + (actual.get("SMH") ?? 0)
  const lt = computeSbrLookThrough(positions)
  const rangeDrift = SBR.funds.filter((f) => {
    const pct = actual.get(f.ticker) ?? 0
    return pct < f.rangeLow || pct > f.rangeHigh
  })
  const hardHoldings = SBR.funds.filter((f) => {
    const pct = actual.get(f.ticker) ?? 0
    return (f.hardCap !== null && pct > f.hardCap) || (f.floor !== undefined && pct < f.floor)
  })
  const checks: GovAlignment["checks"] = [
    { id: "holding-hard", label: "Each ETF respects its hard cap and floor", status: st(hardHoldings.length > 0, false), detail: hardHoldings.length ? `Outside hard limits: ${hardHoldings.map(f => f.ticker).join(", ")}` : "All holding hard limits pass" },
    { id: "satellites", label: `EQAC + SMH stay below ${SBR.combined?.hard}%`, status: st(combined > (SBR.combined?.hard ?? 100), combined >= (SBR.combined?.warning ?? 100)), detail: `Combined satellites ${combined.toFixed(1)}% (watch ${SBR.combined?.warning}%, cap ${SBR.combined?.hard}%)` },
    { id: "company-lt", label: `No company reaches ${SBR_SINGLE_COMPANY_LIMIT}% look-through`, status: st(lt.topCompany.pct >= SBR_SINGLE_COMPANY_LIMIT, lt.topCompany.pct >= SBR_SINGLE_COMPANY_WATCH), detail: `${lt.topCompany.name} is ${lt.topCompany.pct.toFixed(1)}% (watch ${SBR_SINGLE_COMPANY_WATCH}%, review ${SBR_SINGLE_COMPANY_LIMIT}%)` },
    { id: "industry-lt", label: `Technology-related industries stay below ${SBR_TECHNOLOGY_LIMIT}%`, status: st(lt.technologyPct >= SBR_TECHNOLOGY_LIMIT, lt.technologyPct >= SBR_TECHNOLOGY_WATCH), detail: `${lt.technologyPct.toFixed(1)}% (watch ${SBR_TECHNOLOGY_WATCH}%, review ${SBR_TECHNOLOGY_LIMIT}%)` },
    { id: "semiconductor-lt", label: `Semiconductors stay below ${SBR_SEMICONDUCTOR_LIMIT}%`, status: st(lt.semiconductorPct >= SBR_SEMICONDUCTOR_LIMIT, lt.semiconductorPct >= SBR_SEMICONDUCTOR_WATCH), detail: `${lt.semiconductorPct.toFixed(1)}% (watch ${SBR_SEMICONDUCTOR_WATCH}%, review ${SBR_SEMICONDUCTOR_LIMIT}%)` },
    { id: "country-lt", label: `No country reaches ${SBR_COUNTRY_LIMIT}%`, status: st(lt.topCountry.pct >= SBR_COUNTRY_LIMIT, lt.topCountry.pct >= SBR_COUNTRY_WATCH), detail: `${lt.topCountry.name} is ${lt.topCountry.pct.toFixed(1)}% (watch ${SBR_COUNTRY_WATCH}%, review ${SBR_COUNTRY_LIMIT}%)` },
    { id: "asset", label: "Equity remains within the high-risk mandate", status: st(equity > (SBR.totalEquityMaxPct ?? 100), equity > (SBR.totalEquityMaxPct ?? 100) - 2), detail: `Equity ${equity.toFixed(1)}%; managed futures ${(actual.get("DBMFE") ?? 0).toFixed(1)}%` },
    { id: "freshness", label: "Underlying fund data is current", status: st(lt.ageDays > 95, lt.ageDays > 35), detail: `Look-through data age ${lt.ageDays} days` },
    { id: "ranges", label: "Each fund is inside its soft band", status: st(false, rangeDrift.length > 0), detail: rangeDrift.length ? `Contribution routing needed: ${rangeDrift.map(f => f.ticker).join(", ")}` : "All four funds are within range" },
  ]
  const breaches = checks.filter((c) => c.status === "breach").length
  const watches = checks.filter((c) => c.status === "watch").length
  return { checks, breaches, watches, overall: breaches ? "breach" : watches ? "watch" : "ok" }
}
