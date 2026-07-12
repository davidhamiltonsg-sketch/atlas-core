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

/** Governance grouping only. Storage, cost basis and history always retain the original instrument. */
export function economicSleeveTicker(ticker: string): string {
  const symbol = ticker.trim().toUpperCase()
  if (symbol === "IBIT" || symbol === "GBTC") return "BTC"
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
  let ticker = symbol
  if (symbol === "SMH") {
    if (isin === "IE00BMC38736" || exchange?.includes("LSE")) ticker = "SMH"
    else if (cusip === "92189F676" || exchange?.includes("NASDAQ") || exchange?.includes("ARCA")) ticker = "SMH.US"
  }

  if (isin === "LU2951555403") ticker = "DBMFE"
  if (cusip === "46438F101") ticker = "IBIT"

  return { ticker, displayTicker: symbol, instrumentKey: key, isin, cusip, exchange, ibkrConid: conid }
}
