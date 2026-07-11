// ─────────────────────────────────────────────────────────────────────────────
// §6B — Vehicle Transitions: pre-approved alternative ETF vehicles.
//
// The governance tracks ECONOMIC EXPOSURE, not the ticker. Each core position has a
// pre-approved alternative wrapper (usually an Irish UCITS — avoids US estate tax and
// dividend-withholding drag for a Singapore-based investor) with the SAME exposure.
// If you hold the alternative in IBKR, it inherits all the core position's rules.
// ─────────────────────────────────────────────────────────────────────────────

export interface AltVehicle {
  /** Pre-approved alternative tickers for this exposure. */
  tickers: string[]
  /** Why the alternative is preferred / its status. */
  reason: string
}

export const APPROVED_ALTERNATIVES: Record<string, AltVehicle> = {
  VT:   { tickers: ["VWRA"],          reason: "MIGRATED → VWRA (Irish UCITS). Lower all-in cost, no US estate tax." },
  VWO:  { tickers: ["VFEA"],          reason: "MIGRATED → VFEA (Irish UCITS). Same EM exposure, better tax structure." },
  QQQM: { tickers: ["EQQQ", "CNDX"],  reason: "MIGRATED → EQQQ (Irish UCITS NASDAQ-100). SBR uses EQQQ from day one." },
  SMH:  { tickers: ["SEMI"],          reason: "MIGRATED → SEMI (Irish UCITS semis). Same index, no estate tax." },
  BTC:  { tickers: ["IBIT"],          reason: "Held via IBIT. Phased exit: hold until BTC recovers above cost basis × 1.15, then reassess." },
  IBIT: { tickers: [],                reason: "Hold for now. Reassess when a lower-fee or UCITS Bitcoin ETF becomes available." },
}

// Irish-UCITS alternatives (NOT US-sited → outside US estate tax). IBIT is excluded:
// it is a US-domiciled ETF, so it still counts toward US-sited estate-tax exposure.
export const UCITS_TICKERS = ["VWRA", "VFEA", "EQQQ", "CNDX", "SEMI"] as const

/** Is this ticker a US-sited asset (relevant to US estate-tax exposure)? */
export function isUsSited(ticker: string): boolean {
  return !(UCITS_TICKERS as readonly string[]).includes(ticker.toUpperCase())
}

// ─── Governance universe ─────────────────────────────────────────────────────
// Every ticker the policy knows about: the core positions, the cash buffer, and each
// pre-approved alternative vehicle. Anything else held in the brokerage is "out of
// scope" — it is still imported (so the portfolio stays accurate), but flagged as an
// action so you can decide: keep & classify it, switch to an approved fund, or exit.
export const CORE_TICKERS = ["VT", "VWO", "QQQM", "SMH", "BTC", "IBIT", "SGOV"] as const

// SBR-specific tickers: all UCITS/SGX from day one.
export const SBR_TICKERS = ["VWRA", "EQQQ", "SEMI", "A35"] as const

export const GOVERNANCE_UNIVERSE: ReadonlySet<string> = new Set<string>([
  ...CORE_TICKERS,
  ...SBR_TICKERS,
  ...Object.keys(APPROVED_ALTERNATIVES),
  ...Object.values(APPROVED_ALTERNATIVES).flatMap((a) => a.tickers),
])

/** Is this ticker part of the governed policy universe (core, buffer, or approved alternative)? */
export function isInScope(ticker: string): boolean {
  return GOVERNANCE_UNIVERSE.has(ticker.toUpperCase())
}

// Reverse map: an alternative ticker → the core position it stands in for.
export const ALTERNATIVE_TO_CORE: Record<string, string> = {
  VWRA: "VT",
  VFEA: "VWO",
  EQQQ: "QQQM",
  CNDX: "QQQM",
  SEMI: "SMH",
  IBIT: "BTC",
}

/** The core exposure a ticker represents (itself if it's already a core ticker). */
export function coreExposureOf(ticker: string): string {
  return ALTERNATIVE_TO_CORE[ticker.toUpperCase()] ?? ticker.toUpperCase()
}

/** "VWRA is the approved alternative to VT" — label for a held alternative, else null. */
export function altLabelFor(ticker: string): string | null {
  const core = ALTERNATIVE_TO_CORE[ticker.toUpperCase()]
  return core ? `alternative to ${core}` : null
}
