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
  VT:   { tickers: ["VWRA"],          reason: "Irish UCITS — avoids US estate tax & dividend-withholding drag" },
  VWO:  { tickers: ["VFEA"],          reason: "Irish UCITS — same EM exposure, better tax structure" },
  QQQM: { tickers: ["EQQQ", "CNDX"],  reason: "Irish UCITS NASDAQ-100 — avoids US estate tax (higher TER, assess first)" },
  SMH:  { tickers: ["SEMI"],          reason: "Irish UCITS semis — verify index match before switching" },
  BTC:  { tickers: ["IBIT"],          reason: "Held via IBIT (iShares Bitcoin Trust)" },
  IBIT: { tickers: [],                reason: "Switch to a lower-fee / UCITS Bitcoin ETF if one becomes available" },
}

// Irish-UCITS alternatives (NOT US-sited → outside US estate tax). IBIT is excluded:
// it is a US-domiciled ETF, so it still counts toward US-sited estate-tax exposure.
export const UCITS_TICKERS = ["VWRA", "VFEA", "EQQQ", "CNDX", "SEMI"] as const

/** Is this ticker a US-sited asset (relevant to US estate-tax exposure)? */
export function isUsSited(ticker: string): boolean {
  return !(UCITS_TICKERS as readonly string[]).includes(ticker.toUpperCase())
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
