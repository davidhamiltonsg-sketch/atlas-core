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
    if (isin === "IE00BMC38736" || exchange?.includes("LSE")) ticker = "SMH.L"
    else if (cusip === "92189F676" || exchange?.includes("NASDAQ") || exchange?.includes("ARCA")) ticker = "SMH.US"
  }

  return { ticker, displayTicker: symbol, instrumentKey: key, isin, cusip, exchange, ibkrConid: conid }
}
