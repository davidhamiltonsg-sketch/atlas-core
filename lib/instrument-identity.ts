export interface InstrumentIdentityInput {
  symbol: string
  isin?: string
  cusip?: string
  exchange?: string
  conid?: string
}

export interface InstrumentIdentity {
  ticker: string
  displayTicker: string
  instrumentKey: string
  isin: string | null
  cusip: string | null
  exchange: string | null
  ibkrConid: string | null
}

/**
 * Alternate exchange lines of a governed instrument — SAME ISIN, different listing.
 * EQQQ (IE00BFZXGZ54) IS the governed EQAC fund; SEMI (IE00BMC38736) IS the governed
 * SMH fund. Identity beats ticker: these rows are governed exposure, never "legacy",
 * and aggregate into their sleeve for targets, bands and combined ceilings.
 */
export const GOVERNED_LINE_ALIASES: Record<string, string> = {
  EQQQ: "EQAC",
  SEMI: "SMH",
}

/** Governance grouping only. Storage, cost basis and history always retain the original instrument. */
export function economicSleeveTicker(ticker: string): string {
  const symbol = ticker.trim().toUpperCase()
  if (symbol === "IBIT" || symbol === "GBTC") return "BTC"
  if (GOVERNED_LINE_ALIASES[symbol]) return GOVERNED_LINE_ALIASES[symbol]
  if (symbol === "SMH.US" || symbol === "SMH_US" || symbol === "SMH-US") return "SMH_LEGACY_US"
  return symbol
}

export function instrumentIdentity(input: InstrumentIdentityInput): InstrumentIdentity {
  const symbol = input.symbol.trim().toUpperCase()
  const isin = input.isin?.trim().toUpperCase() || null
  const cusip = input.cusip?.trim().toUpperCase() || null
  const exchange = input.exchange?.trim().toUpperCase() || null
  const conid = input.conid?.trim() || null
  const key = isin ? `ISIN:${isin}` : cusip ? `CUSIP:${cusip}` : conid ? `IBKR:${conid}` : `TICKER:${exchange ?? "UNKNOWN"}:${symbol}`

  // SMH is ambiguous: the US ETF and Irish UCITS ETF use the same visible ticker on
  // different venues. Venue-qualify storage while keeping the familiar display label.
  // Fail-safe direction: only a positively-confirmed UCITS identity (ISIN or LSE
  // listing) counts as the governed line. Every other case — including exchange
  // strings IBKR sends that we haven't enumerated (e.g. "ISLAND") — defaults to the
  // legacy US line rather than silently being swept into governed scope.
  let ticker = symbol
  if (symbol === "SMH") {
    ticker = isin === "IE00BMC38736" || exchange?.includes("LSE") ? "SMH" : "SMH.US"
  }

  if (isin === "LU2951555403") ticker = "DBMFE"
  if (cusip === "46438F101") ticker = "IBIT"

  return { ticker, displayTicker: symbol, instrumentKey: key, isin, cusip, exchange, ibkrConid: conid }
}
