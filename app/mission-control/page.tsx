import type { Metadata } from "next"
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google"
import { getSession } from "@/lib/session"
import { constitutionIdForEmail } from "@/lib/constitutions"
import { db } from "@/lib/db"
import { MissionControl, type PortfolioContext } from "@/components/mission-control/mission-control"

// Mission Control is a personal, auth-gated console — never statically cached.
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Mission Control · Atlas",
  description: "Live agent dispatch console for the Atlas governance engines.",
}

// The three brand fonts from the mission-control brief, exposed as CSS variables
// the client component reads: Space Grotesk (display) · Inter (body) · JetBrains Mono (data).
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" })
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" })
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" })

// Representative context shown when logged out (or with no snapshots yet) so the
// console still reads as a real command centre. Clearly flagged SAMPLE in the UI.
const SAMPLE_CONTEXT: PortfolioContext = {
  label: "Atlas Core",
  totalValue: 284_500,
  currency: "SGD",
  dayChangePct: 0.42,
  cashPct: 3.1,
  driftAlerts: 1,
  live: false,
  variant: "atlas",
  holdings: [
    { ticker: "VT",   name: "World Equity Core",   pct: 34.0, color: "#4A9EFF" },
    { ticker: "QQQM", name: "Growth Sleeve",       pct: 23.0, color: "#C9A84C" },
    { ticker: "VOO",  name: "US Large Cap",        pct: 18.0, color: "#2ECC9A" },
    { ticker: "VWO",  name: "Emerging Markets",    pct: 9.0,  color: "#8B7FE8" },
    { ticker: "BTC",  name: "Bitcoin Sleeve",      pct: 7.0,  color: "#E0913A" },
    { ticker: "SGOV", name: "Cash / T-Bills",      pct: 3.1,  color: "#5A6B8C" },
    { ticker: "A35",  name: "SG Bonds",            pct: 5.9,  color: "#3EC9C0" },
  ],
}

// Silicon Brick Road sample — its four funds, plain-English names, SGD.
const SBR_SAMPLE_CONTEXT: PortfolioContext = {
  label: "Silicon Brick Road",
  totalValue: 18_400,
  currency: "SGD",
  dayChangePct: 0.31,
  cashPct: null,
  driftAlerts: 1,
  live: false,
  variant: "sbr",
  holdings: [
    { ticker: "VWRA", name: "Global fund",          pct: 60.0, color: "#4A9EFF" },
    { ticker: "A35",  name: "Singapore bond fund",  pct: 20.0, color: "#2ECC9A" },
    { ticker: "EQQQ", name: "Nasdaq fund",          pct: 10.0, color: "#C9A84C" },
    { ticker: "SMH",  name: "Chip-maker fund",      pct: 10.0, color: "#E0913A" },
  ],
}

async function loadPortfolioContext(): Promise<PortfolioContext> {
  const session = await getSession()
  if (!session) return SAMPLE_CONTEXT

  const isSbr = constitutionIdForEmail(session.email) === "silicon-brick-road"
  const label = isSbr ? "Silicon Brick Road" : "Atlas Core"
  const fallback = isSbr ? SBR_SAMPLE_CONTEXT : SAMPLE_CONTEXT

  try {

    const holdings = await db.holding.findMany({
      where: { userId: session.userId },
      include: { snapshots: { orderBy: { date: "desc" }, take: 2 } },
    })

    const rows = holdings
      .map(h => ({
        ticker: h.ticker,
        name: h.name,
        color: h.color || "#5A6B8C",
        targetPct: h.targetPct,
        toleranceBand: h.toleranceBand,
        value: h.snapshots[0]?.value ?? 0,
        prevValue: h.snapshots[1]?.value ?? h.snapshots[0]?.value ?? 0,
      }))
      .filter(r => r.value > 0)

    const total = rows.reduce((s, r) => s + r.value, 0)
    if (total <= 0) return fallback

    const prevTotal = rows.reduce((s, r) => s + r.prevValue, 0)
    const dayChangePct = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null

    const withPct = rows.map(r => ({ ...r, pct: (r.value / total) * 100 }))
    const driftAlerts = withPct.filter(r => r.targetPct > 0 && Math.abs(r.pct - r.targetPct) > r.toleranceBand).length
    const cashPct = withPct.filter(r => ["SGOV", "CASH", "SGD"].includes(r.ticker.toUpperCase())).reduce((s, r) => s + r.pct, 0)

    const holdingsOut = withPct
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 8)
      .map(r => ({ ticker: r.ticker, name: r.name, pct: r.pct, color: r.color }))

    return {
      label,
      totalValue: total,
      currency: "SGD",
      dayChangePct,
      cashPct: cashPct > 0 ? cashPct : null,
      driftAlerts,
      live: true,
      holdings: holdingsOut,
      variant: isSbr ? "sbr" : "atlas",
    }
  } catch {
    // A console should never crash the app — degrade to the sample context
    // for whichever portfolio the signed-in user owns.
    return fallback
  }
}

export default async function MissionControlPage() {
  const context = await loadPortfolioContext()
  return (
    <div className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <MissionControl context={context} />
    </div>
  )
}
