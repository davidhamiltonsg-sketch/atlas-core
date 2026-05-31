const FLEX_BASE = "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService"

export interface FlexPosition {
  symbol: string
  units: number
  markPrice: number    // USD per unit (IBKR close price)
  positionValue: number // in account base currency (SGD)
  currency: string     // instrument currency, e.g. "USD"
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
}

export interface FlexDividend {
  transactionID: string
  symbol: string
  amount: number     // in account base currency (SGD)
  payDate: string    // YYYYMMDD
  description: string
}

export type FlexActivityResult =
  | { success: true; executions: FlexExecution[]; dividends: FlexDividend[]; accountId: string }
  | { success: false; error: string }

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function attr(attrs: string, key: string): string {
  const m = attrs.match(new RegExp(`${key}="([^"]*)"`) )
  return m?.[1] ?? ""
}

function parseFlexXml(xml: string): { positions: FlexPosition[]; accountId: string; reportDate: string } {
  const positions: FlexPosition[] = []
  const re = /<OpenPosition\s+([^>]+)\/?>/g
  let match: RegExpExecArray | null

  while ((match = re.exec(xml)) !== null) {
    const a = match[1]
    const symbol = attr(a, "symbol")
    const units = parseFloat(attr(a, "position"))
    const markPrice = parseFloat(attr(a, "markPrice"))
    const positionValue = parseFloat(attr(a, "positionValue"))
    const currency = attr(a, "currency")

    if (symbol && !isNaN(units) && units > 0 && !isNaN(markPrice)) {
      positions.push({ symbol, units, markPrice, positionValue, currency })
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

function parseFlexActivity(xml: string): { executions: FlexExecution[]; dividends: FlexDividend[]; accountId: string } {
  const executions: FlexExecution[] = []
  const dividends: FlexDividend[] = []

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

    if (symbol && tradeID && !isNaN(quantity) && !isNaN(price)) {
      executions.push({ tradeID, symbol, buySell, quantity: Math.abs(quantity), price, currency, fxRate, tradeDate })
    }
  }

  // Parse dividends (CashTransaction where type="Dividends")
  const cashRe = /<CashTransaction\s+([^>]+)\/?>/g
  while ((m = cashRe.exec(xml)) !== null) {
    const a = m[1]
    if (attr(a, "type") !== "Dividends") continue
    const symbol        = attr(a, "symbol")
    const transactionID = attr(a, "transactionID")
    const amount        = parseFloat(attr(a, "amount"))
    const description   = attr(a, "description")
    // dateTime format: "YYYYMMDD;HHMMSS" or "YYYYMMDD"
    const rawDate = attr(a, "dateTime") || attr(a, "reportDate")
    const payDate = rawDate.split(";")[0]

    if (symbol && transactionID && !isNaN(amount) && amount > 0) {
      dividends.push({ transactionID, symbol, amount, payDate, description })
    }
  }

  return {
    executions,
    dividends,
    accountId: xml.match(/accountId="([^"]+)"/)?.[1] ?? "",
  }
}

const RETRYABLE = ["Please try again shortly", "Statement generation in progress", "Statement could not be generated"]

export async function fetchFlexActivity(token: string, queryId: string): Promise<FlexActivityResult> {
  try {
    const sendUrl = `${FLEX_BASE}.SendRequest?v=3&t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&p=3`

    // Step 1: single SendRequest — no retry (IBKR rate limits on repeated calls)
    const sendRes = await fetch(sendUrl, { cache: "no-store" })
    if (!sendRes.ok) return { success: false, error: `IBKR SendRequest HTTP ${sendRes.status}` }

    const sendXml = await sendRes.text()
    const referenceCode = sendXml.match(/referenceCode="([^"]+)"/)?.[1]
    const getUrl = sendXml.match(/url="([^"]+)"/)?.[1] ?? `${FLEX_BASE}.GetStatement`

    if (!referenceCode) {
      const ibkrError = extractError(sendXml)
      // Rate limit / temporary unavailability — tell user to wait
      if (RETRYABLE.some(s => sendXml.includes(s))) {
        const errorCode = sendXml.match(/<ErrorCode>([^<]+)<\/ErrorCode>/)?.[1] ?? ""
        return {
          success: false,
          error: `IBKR${errorCode ? ` (error ${errorCode})` : ""}: ${ibkrError}. Wait 15–20 minutes before retrying — repeated requests extend the rate limit window.`,
        }
      }
      return { success: false, error: `IBKR: ${ibkrError}` }
    }

    // Step 2: poll for result (max ~25s to stay within Vercel 30s limit)
    for (let attempt = 0; attempt < 5; attempt++) {
      await sleep(attempt === 0 ? 4000 : 4000)
      const getRes = await fetch(
        `${getUrl}?q=${encodeURIComponent(referenceCode)}&t=${encodeURIComponent(token)}&v=3`,
        { cache: "no-store" }
      )
      if (!getRes.ok) return { success: false, error: `IBKR GetStatement HTTP ${getRes.status}` }
      const xml = await getRes.text()

      if (xml.includes("<Execution") || xml.includes("<Trade ") || xml.includes("<CashTransaction")) {
        const { executions, dividends, accountId } = parseFlexActivity(xml)
        return { success: true, executions, dividends, accountId }
      }
      // Valid FLEX report but positions-only query — return empty gracefully
      if (xml.includes("<OpenPosition") || xml.includes("<FlexStatement")) {
        return { success: true, executions: [], dividends: [], accountId: xml.match(/accountId="([^"]+)"/)?.[1] ?? "" }
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
    // Step 1: request statement generation
    const sendUrl = `${FLEX_BASE}.SendRequest?v=3&t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&p=3`
    const sendRes = await fetch(sendUrl, { cache: "no-store" })
    if (!sendRes.ok) return { success: false, error: `IBKR SendRequest HTTP ${sendRes.status}` }

    const sendXml = await sendRes.text()
    const referenceCode = sendXml.match(/referenceCode="([^"]+)"/)?.[1]
    const getUrl = sendXml.match(/url="([^"]+)"/)?.[1] ?? `${FLEX_BASE}.GetStatement`

    if (!referenceCode) {
      return { success: false, error: extractError(sendXml) }
    }

    // Step 2: poll until ready (max ~30s)
    for (let attempt = 0; attempt < 6; attempt++) {
      await sleep(attempt === 0 ? 4000 : 3000)

      const getRes = await fetch(
        `${getUrl}?q=${encodeURIComponent(referenceCode)}&t=${encodeURIComponent(token)}&v=3`,
        { cache: "no-store" }
      )
      if (!getRes.ok) return { success: false, error: `IBKR GetStatement HTTP ${getRes.status}` }

      const xml = await getRes.text()

      if (xml.includes("<OpenPosition")) {
        const { positions, accountId, reportDate } = parseFlexXml(xml)
        if (positions.length === 0) {
          return { success: false, error: "IBKR returned a report but no open positions were found" }
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
