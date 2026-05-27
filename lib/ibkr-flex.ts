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
