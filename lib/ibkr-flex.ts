const FLEX_BASE = "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService"

/** Flex dates arrive as bare "YYYYMMDD" — render them the same way everywhere a Flex
 *  activity row is shown (activity import, closing refresh). Non-Flex-shaped strings
 *  pass through unchanged rather than throwing. */
export function formatFlexDate(s: string): string {
  if (s.length === 8) {
    return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "2-digit",
    })
  }
  return s
}

export interface FlexPosition {
  symbol: string
  units: number
  markPrice: number    // USD per unit (IBKR close price)
  positionValue: number // in account base currency (SGD)
  currency: string     // instrument currency, e.g. "USD"
  costBasis: number | null       // account base currency when provided by Flex
  unrealizedPnl: number | null   // account base currency when provided by Flex
  isin: string
  cusip: string
  exchange: string
  conid: string
}

export type FlexResult =
  | { success: true; positions: FlexPosition[]; accountId: string; reportDate: string }
  | { success: false; error: string }

// ── Activity (Executions + Dividends) ──────────────────────────────────────

export interface FlexExecution {
  tradeID: string
  symbol: string
  buySell: "BUY" | "SELL"
  quantity: number   // always positive; buySell distinguishes direction
  price: number      // USD per unit
  currency: string   // instrument currency (usually USD)
  fxRate: number     // fxRateToBase = USDSGD at execution time
  tradeDate: string  // YYYYMMDD
  commission?: number
  realizedPnl?: number | null
  netCash?: number | null
  isin?: string
  cusip?: string
  exchange?: string
  conid?: string
}

export interface FlexDividend {
  transactionID: string
  symbol: string
  amount: number     // in account base currency (SGD)
  payDate: string    // YYYYMMDD
  description: string
}

export type FlexLedgerCategory = "DEPOSIT" | "WITHDRAWAL" | "FEE" | "TAX" | "INTEREST" | "CORPORATE_ACTION" | "FX" | "OTHER"

export interface FlexLedgerEntry {
  externalId: string
  category: FlexLedgerCategory
  symbol: string
  amount: number
  currency: string
  amountBase: number | null
  fxRate: number | null
  date: string
  description: string
  rawType: string
}

export type FlexActivityResult =
  | { success: true; executions: FlexExecution[]; dividends: FlexDividend[]; ledger: FlexLedgerEntry[]; accountId: string }
  | { success: false; error: string }

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function attr(attrs: string, key: string): string {
  const m = attrs.match(new RegExp(`${key}="([^"]*)"`) )
  return m?.[1] ?? ""
}

// A forex / cash currency-conversion row (e.g. USD.SGD, SGD.HKD, USD.HKD) is NOT an
// investment trade or a contribution — it is just money moving between currencies inside
// the IBKR account. Importing these as equity trades inflates the trade log, invents
// bogus "contributions", and pollutes the risk timeline with ghost holdings.
// Identify them two ways for robustness: IBKR's assetCategory="CASH", or a CCC.CCC symbol.
const FOREX_SYMBOL = /^[A-Z]{3}\.[A-Z]{3}$/
export function isForexRow(symbol: string, assetCategory?: string): boolean {
  if (assetCategory && assetCategory.toUpperCase() === "CASH") return true
  return FOREX_SYMBOL.test(symbol.trim().toUpperCase())
}

// Exported for __tests__/ibkr-flex-parse.test.ts AND the Flex email-delivery webhook
// (which already has the raw XML from IBKR's scheduled delivery — no SendRequest/
// GetStatement round trip needed, just this parse step).
export function parseFlexXml(xml: string): { positions: FlexPosition[]; accountId: string; reportDate: string } {
  // A query configured with Open Positions "Summary, Lot" emits BOTH a SUMMARY row and one
  // row per tax lot for the same position. Counting every row double- (or N-times-) counts
  // every holding, so rows are grouped by symbol+currency and reduced to one row per group.
  //
  // The summary/lot signal is NOT always levelOfDetail: some exports omit that attribute
  // entirely (observed on a real Atlas Flex query — every OpenPosition row had no
  // levelOfDetail at all) and instead only populate percentOfNAV on the account-level
  // summary row, leaving it blank on the lot rows beneath it. Both signals are checked;
  // a group with neither falls back to summing every row (the historical lot-only path).
  interface RawRow extends FlexPosition { isLot: boolean; hasPercentOfNav: boolean }
  const raw: RawRow[] = []
  const re = /<OpenPosition\s+([^>]+)\/?>/g
  let match: RegExpExecArray | null

  while ((match = re.exec(xml)) !== null) {
    const a = match[1]
    const symbol = attr(a, "symbol")
    let units = parseFloat(attr(a, "position"))
    const markPrice = parseFloat(attr(a, "markPrice"))
    const positionValue = parseFloat(attr(a, "positionValue"))
    const currency = attr(a, "currency")
    const costBasisRaw = parseFloat(attr(a, "costBasisMoney") || attr(a, "costBasis") || attr(a, "fifoPnlUnrealizedCostBasis"))
    const unrealizedRaw = parseFloat(attr(a, "fifoPnlUnrealized") || attr(a, "unrealizedPnl"))

    // Skip forex / cash balances — a currency position is not an investment holding.
    if (isForexRow(symbol, attr(a, "assetCategory"))) continue

    // position (units) is likewise an OPTIONAL Flex column — a real Atlas Flex query
    // configuration (observed accountId U13800637, symbol BTC "GRAYSCALE BITCOIN MINI ETF",
    // production logs 2026-07-04 through 2026-07-19) omits it from every OpenPosition row
    // while still including markPrice and positionValue. Requiring units here dropped every
    // position in that report and the sync silently reported "parsed 0 positions" even though
    // real value data was present in the XML the whole time. Derive units the same way markPrice
    // is derived below, just inverted: positionValue / markPrice.
    if (isNaN(units) && !isNaN(positionValue) && !isNaN(markPrice) && markPrice !== 0) {
      units = positionValue / markPrice
    }

    // Keep a position as long as it has a symbol, positive units, and AT LEAST ONE value field.
    // markPrice is an OPTIONAL Flex column — if the query doesn't include it, requiring it here
    // silently dropped every real position and surfaced as "no open positions were found". Derive
    // the missing field from the other so the value still lands.
    const hasValue = !isNaN(markPrice) || !isNaN(positionValue)
    if (symbol && !isNaN(units) && units > 0 && hasValue) {
      const mp = isNaN(markPrice) ? (units > 0 && !isNaN(positionValue) ? positionValue / units : 0) : markPrice
      const pv = isNaN(positionValue) ? units * mp : positionValue
      const percentOfNav = parseFloat(attr(a, "percentOfNAV"))
      raw.push({
        symbol, units, markPrice: mp, positionValue: pv, currency,
        costBasis: Number.isFinite(costBasisRaw) ? costBasisRaw : null,
        unrealizedPnl: Number.isFinite(unrealizedRaw) ? unrealizedRaw : null,
        isin: attr(a, "isin"), cusip: attr(a, "cusip"),
        exchange: attr(a, "listingExchange") || attr(a, "exchange"),
        conid: attr(a, "conid"),
        isLot: attr(a, "levelOfDetail").toUpperCase() === "LOT",
        hasPercentOfNav: Number.isFinite(percentOfNav),
      })
    }
  }

  const groups = new Map<string, RawRow[]>()
  for (const row of raw) {
    const key = `${row.symbol}|${row.currency}`
    const g = groups.get(key)
    if (g) g.push(row); else groups.set(key, [row])
  }

  const bare = (r: RawRow): FlexPosition => {
    const { isLot: _isLot, hasPercentOfNav: _hasPct, ...rest } = r
    return rest
  }

  const positions: FlexPosition[] = []
  for (const rows of groups.values()) {
    if (rows.length === 1) { positions.push(bare(rows[0])); continue }
    const explicitLotMarked = rows.some((r) => r.isLot)
    const summaryRow = explicitLotMarked ? rows.find((r) => !r.isLot) : rows.find((r) => r.hasPercentOfNav)
    if (summaryRow) {
      positions.push(bare(summaryRow))
    } else {
      // No distinguishing signal at all — sum every row (the prior lot-aggregation fallback).
      const agg = bare(rows[0])
      for (const r of rows.slice(1)) {
        agg.units += r.units
        agg.positionValue += r.positionValue
        agg.costBasis = agg.costBasis !== null && r.costBasis !== null ? agg.costBasis + r.costBasis : null
        agg.unrealizedPnl = agg.unrealizedPnl !== null && r.unrealizedPnl !== null ? agg.unrealizedPnl + r.unrealizedPnl : null
      }
      agg.markPrice = agg.units > 0 ? agg.positionValue / agg.units : agg.markPrice
      positions.push(agg)
    }
  }

  return {
    positions,
    accountId: xml.match(/accountId="([^"]+)"/)?.[1] ?? "",
    reportDate: xml.match(/reportDate="([^"]+)"/)?.[1] ?? "",
  }
}

function extractError(xml: string): string {
  return (
    xml.match(/UserErrorMessage="([^"]+)"/)?.[1] ??
    xml.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/)?.[1] ??
    xml.match(/<ErrorCode>([^<]+)<\/ErrorCode>/)?.[1] ??
    "Unknown IBKR error"
  )
}

function classifyCashType(type: string, description: string, amount: number): FlexLedgerCategory {
  const value = `${type} ${description}`.toLowerCase()
  if (/deposit|wire|electronic fund transfer|cash receipt/.test(value)) return amount >= 0 ? "DEPOSIT" : "WITHDRAWAL"
  if (/withdrawal|disbursement/.test(value)) return "WITHDRAWAL"
  if (/withholding|tax/.test(value)) return "TAX"
  if (/commission|fee|expense/.test(value)) return "FEE"
  if (/interest|bond interest/.test(value)) return "INTEREST"
  if (/forex|fx translation/.test(value)) return "FX"
  return "OTHER"
}

// Exported so both fetchFlexActivity (SendRequest/GetStatement path) and the Flex
// email-delivery webhook (which already has the raw XML, no round trip needed) share
// one parser.
export function parseFlexActivity(xml: string): { executions: FlexExecution[]; dividends: FlexDividend[]; ledger: FlexLedgerEntry[]; accountId: string } {
  const executions: FlexExecution[] = []
  const dividends: FlexDividend[] = []
  const ledger: FlexLedgerEntry[] = []

  // Parse executions — handles both <Execution> (Executions section) and
  // <Trade> (Trades section, Options: Execution) formats from IBKR Activity Flex
  const execRe = /<(?:Execution|Trade)\s+([^>]+)\/?>/g
  let m: RegExpExecArray | null
  while ((m = execRe.exec(xml)) !== null) {
    const a = m[1]
    const buySell = attr(a, "buySell") as "BUY" | "SELL"
    if (buySell !== "BUY" && buySell !== "SELL") continue // skip non-execution Trade elements

    const symbol    = attr(a, "symbol")
    const tradeID   = attr(a, "tradeID")
    const quantity  = parseFloat(attr(a, "quantity"))
    const price     = parseFloat(attr(a, "tradePrice"))
    const currency  = attr(a, "currency")
    const fxRate    = parseFloat(attr(a, "fxRateToBase")) || 1.35
    const tradeDate = attr(a, "tradeDate") || attr(a, "dateTime")?.split(";")?.[0] || ""
    const commission = Math.abs(parseFloat(attr(a, "ibCommission") || attr(a, "commission") || "0"))
    const realized = parseFloat(attr(a, "fifoPnlRealized") || attr(a, "realizedPnl"))
    const netCashRaw = parseFloat(attr(a, "netCash"))

    // Skip forex / cash conversions — they are not investment trades (see isForexRow).
    if (isForexRow(symbol, attr(a, "assetCategory"))) continue

    if (symbol && tradeID && !isNaN(quantity) && !isNaN(price)) {
      executions.push({
        tradeID, symbol, buySell, quantity: Math.abs(quantity), price, currency, fxRate, tradeDate,
        commission: Number.isFinite(commission) ? commission : 0,
        realizedPnl: Number.isFinite(realized) ? realized : null,
        netCash: Number.isFinite(netCashRaw) ? netCashRaw : null,
        isin: attr(a, "isin"), cusip: attr(a, "cusip"),
        exchange: attr(a, "listingExchange") || attr(a, "exchange"), conid: attr(a, "conid"),
      })
    }
  }

  // Parse dividends (CashTransaction where type="Dividends")
  const cashRe = /<CashTransaction\s+([^>]+)\/?>/g
  while ((m = cashRe.exec(xml)) !== null) {
    const a = m[1]
    const type = attr(a, "type")
    const symbol        = attr(a, "symbol")
    const transactionID = attr(a, "transactionID")
    const amount        = parseFloat(attr(a, "amount"))
    const description   = attr(a, "description")
    // dateTime format: "YYYYMMDD;HHMMSS" or "YYYYMMDD"
    const rawDate = attr(a, "dateTime") || attr(a, "reportDate")
    const payDate = rawDate.split(";")[0]

    if (type === "Dividends" && symbol && transactionID && !isNaN(amount) && amount > 0) {
      dividends.push({ transactionID, symbol, amount, payDate, description })
    } else if (transactionID && !isNaN(amount)) {
      const currency = attr(a, "currency") || attr(a, "currencyPrimary")
      const fx = parseFloat(attr(a, "fxRateToBase"))
      const amountBaseRaw = parseFloat(attr(a, "amountInBase") || attr(a, "amountBase"))
      ledger.push({
        externalId: transactionID,
        category: classifyCashType(type, description, amount),
        symbol,
        amount,
        currency,
        amountBase: Number.isFinite(amountBaseRaw) ? amountBaseRaw : null,
        fxRate: Number.isFinite(fx) ? fx : null,
        date: payDate,
        description,
        rawType: type,
      })
    }
  }

  const actionRe = /<CorporateAction\s+([^>]+)\/?>/g
  while ((m = actionRe.exec(xml)) !== null) {
    const a = m[1]
    const externalId = attr(a, "transactionID") || attr(a, "actionID")
    if (!externalId) continue
    const rawDate = attr(a, "dateTime") || attr(a, "reportDate")
    const amount = parseFloat(attr(a, "proceeds") || attr(a, "amount") || "0")
    const fx = parseFloat(attr(a, "fxRateToBase"))
    ledger.push({
      externalId: `ca:${externalId}`, category: "CORPORATE_ACTION", symbol: attr(a, "symbol"),
      amount: Number.isFinite(amount) ? amount : 0, currency: attr(a, "currency"),
      amountBase: null, fxRate: Number.isFinite(fx) ? fx : null, date: rawDate.split(";")[0],
      description: attr(a, "description") || attr(a, "actionDescription"), rawType: attr(a, "type") || attr(a, "actionType"),
    })
  }

  return {
    executions,
    dividends,
    ledger,
    accountId: xml.match(/accountId="([^"]+)"/)?.[1] ?? "",
  }
}

const RETRYABLE = ["Please try again shortly", "Statement generation in progress", "Statement could not be generated"]

export async function fetchFlexActivity(token: string, queryId: string): Promise<FlexActivityResult> {
  try {
    const sendUrl = `${FLEX_BASE}.SendRequest?v=3&t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&p=3`

    // Step 1: SendRequest. IBKR's report engine is sometimes momentarily busy and returns
    // error 1001 ("Statement could not be generated at this time. Please try again shortly.")
    // with NO reference code — a transient condition, not the same as a rate-limit (1018/1019).
    // Retry ONCE after a short wait for that transient case; never hammer it (rapid repeats
    // extend IBKR's rate-limit window), so a second transient failure gives up with guidance.
    let referenceCode: string | undefined
    let getUrl = `${FLEX_BASE}.GetStatement`
    let lastSendXml = ""
    for (let sendAttempt = 0; sendAttempt < 3; sendAttempt++) {
      if (sendAttempt > 0) await sleep(sendAttempt === 1 ? 5000 : 12000)
      const sendRes = await fetch(sendUrl, { cache: "no-store" })
      if (!sendRes.ok) return { success: false, error: `IBKR SendRequest HTTP ${sendRes.status}` }
      lastSendXml = await sendRes.text()

      // IBKR v3 returns ReferenceCode as an XML element: <ReferenceCode>12345</ReferenceCode>
      // (older integrations may have used attribute form; we check both)
      referenceCode =
        lastSendXml.match(/referenceCode="([^"]+)"/)?.[1] ??
        lastSendXml.match(/<ReferenceCode>([^<]+)<\/ReferenceCode>/i)?.[1]
      getUrl =
        lastSendXml.match(/url="([^"]+)"/)?.[1] ??
        lastSendXml.match(/<Url>([^<]+)<\/Url>/i)?.[1] ??
        `${FLEX_BASE}.GetStatement`

      if (referenceCode) break
      // Only retry the transient "could not be generated / try again shortly" case.
      if (!RETRYABLE.some(s => lastSendXml.includes(s))) break
    }

    if (!referenceCode) {
      const sendXml = lastSendXml
      const ibkrError = extractError(sendXml)
      // Log first 600 chars of raw response to help diagnose unexpected formats
      console.error("[ibkr-flex] SendRequest no referenceCode after retry. Raw XML (600):", sendXml.slice(0, 600))
      // Transient / rate limit — tell the user to wait rather than keep tapping
      if (RETRYABLE.some(s => sendXml.includes(s))) {
        const errorCode = sendXml.match(/<ErrorCode>([^<]+)<\/ErrorCode>/)?.[1] ?? ""
        return {
          success: false,
          error: `IBKR${errorCode ? ` (error ${errorCode})` : ""}: ${ibkrError} IBKR's report engine is busiest from US market close until late evening New York time — try again in a few minutes, or after 6 AM New York / 6 PM Singapore when statements are reliably ready. Tapping repeatedly extends the wait.`,
        }
      }
      return { success: false, error: `IBKR: ${ibkrError}` }
    }

    // Step 2: poll for result. IBKR's own guidance is not to poll GetStatement faster than
    // roughly every 5-10s — polling faster doesn't make the report generate any sooner, and
    // each "not ready yet" response adds to whatever failure count feeds IBKR's own lockout
    // (ErrorCode 1025, "Too many failed attempts"). 3 polls spaced 5s/7s/7s (~19s total) covers
    // about the same wait window as the previous 5×4s (~20s) with fewer, better-spaced requests.
    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(attempt === 0 ? 5000 : 7000)
      const getRes = await fetch(
        `${getUrl}?q=${encodeURIComponent(referenceCode)}&t=${encodeURIComponent(token)}&v=3`,
        { cache: "no-store" }
      )
      if (!getRes.ok) return { success: false, error: `IBKR GetStatement HTTP ${getRes.status}` }
      const xml = await getRes.text()

      if (xml.includes("<Execution") || xml.includes("<Trade ") || xml.includes("<CashTransaction") || xml.includes("<CorporateAction")) {
        const { executions, dividends, ledger, accountId } = parseFlexActivity(xml)
        return { success: true, executions, dividends, ledger, accountId }
      }
      // Valid FLEX report but positions-only query — return empty gracefully
      if (xml.includes("<OpenPosition") || xml.includes("<FlexStatement")) {
        return { success: true, executions: [], dividends: [], ledger: [], accountId: xml.match(/accountId="([^"]+)"/)?.[1] ?? "" }
      }
      if (RETRYABLE.some(s => xml.includes(s))) continue
      return { success: false, error: extractError(xml) }
    }
    return { success: false, error: "IBKR activity report timed out — try again" }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Network error fetching FLEX activity" }
  }
}

export async function fetchFlexPositions(token: string, queryId: string): Promise<FlexResult> {
  try {
    // Step 1: request statement generation. IBKR's report engine is sometimes momentarily busy
    // and returns error 1001 ("Statement could not be generated at this time. Please try again
    // shortly.") with NO reference code — a transient condition, not a rate-limit (1018/1019).
    // Retry ONCE after a short wait for that transient case (mirrors fetchFlexActivity); without
    // this the authoritative position/value sync fails on a blip and the portfolio can't refresh
    // to IBKR's true values. Never hammer it — a second transient failure gives up with guidance.
    const sendUrl = `${FLEX_BASE}.SendRequest?v=3&t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&p=3`
    let referenceCode: string | undefined
    let getUrl = `${FLEX_BASE}.GetStatement`
    let sendXml = ""
    for (let sendAttempt = 0; sendAttempt < 3; sendAttempt++) {
      if (sendAttempt > 0) await sleep(sendAttempt === 1 ? 5000 : 12000)
      const sendRes = await fetch(sendUrl, { cache: "no-store" })
      if (!sendRes.ok) return { success: false, error: `IBKR SendRequest HTTP ${sendRes.status}` }
      sendXml = await sendRes.text()

      referenceCode =
        sendXml.match(/referenceCode="([^"]+)"/)?.[1] ??
        sendXml.match(/<ReferenceCode>([^<]+)<\/ReferenceCode>/i)?.[1]
      getUrl =
        sendXml.match(/url="([^"]+)"/)?.[1] ??
        sendXml.match(/<Url>([^<]+)<\/Url>/i)?.[1] ??
        `${FLEX_BASE}.GetStatement`

      if (referenceCode) break
      if (!RETRYABLE.some((s) => sendXml.includes(s))) break // only retry the transient case
    }

    if (!referenceCode) {
      console.error("[ibkr-flex] fetchFlexPositions no referenceCode after retry. Raw XML (600):", sendXml.slice(0, 600))
      const ibkrError = extractError(sendXml)
      if (RETRYABLE.some((s) => sendXml.includes(s))) {
        return { success: false, error: `IBKR: ${ibkrError} IBKR's report engine is busiest from US market close until late evening New York time — try again in a few minutes, or after 6 AM New York / 6 PM Singapore when statements are reliably ready. Tapping repeatedly extends the wait.` }
      }
      return { success: false, error: `IBKR: ${ibkrError}` }
    }

    // Step 2: poll until ready. Same cadence reasoning as fetchFlexActivity — IBKR recommends
    // not polling GetStatement faster than ~5-10s; polling harder doesn't speed up report
    // generation and adds to whatever failure count feeds IBKR's own lockout (ErrorCode 1025,
    // "Too many failed attempts"). 3 polls spaced 5s/7s/7s (~19s total) covers about the same
    // wait window as the previous 6×3-4s (~19s) with half the request count.
    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(attempt === 0 ? 5000 : 7000)

      const getRes = await fetch(
        `${getUrl}?q=${encodeURIComponent(referenceCode)}&t=${encodeURIComponent(token)}&v=3`,
        { cache: "no-store" }
      )
      if (!getRes.ok) return { success: false, error: `IBKR GetStatement HTTP ${getRes.status}` }

      const xml = await getRes.text()

      if (xml.includes("<OpenPosition")) {
        const { positions, accountId, reportDate } = parseFlexXml(xml)
        if (positions.length === 0) {
          // The report DID contain OpenPosition markup but nothing survived parsing. Log a raw
          // sample so the actual attribute names/format are visible in the runtime logs, and tell
          // the user the likely cause instead of a dead-end "none found".
          const sample = xml.match(/<OpenPosition\b[^>]*>/)?.[0] ?? "(no <OpenPosition ...> row found — the report may be positions-empty)"
          console.error("[ibkr-flex] fetchFlexPositions parsed 0 positions. Sample OpenPosition row:", sample.slice(0, 400))
          return {
            success: false,
            error: "IBKR returned a report but no open positions could be read. If you hold positions, the Flex query is likely missing the position/markPrice/positionValue fields — add them to the query in IBKR (or confirm the account currently holds open positions).",
          }
        }
        return { success: true, positions, accountId, reportDate }
      }

      // Still generating
      if (
        xml.includes("Statement generation in progress") ||
        xml.includes("Please try again shortly")
      ) {
        continue
      }

      // Error in response
      return { success: false, error: extractError(xml) }
    }

    return { success: false, error: "IBKR report timed out — try again in a moment" }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Network error fetching FLEX data" }
  }
}
