import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { getSession } from "@/lib/session"
import { constitutionIdForEmail } from "@/lib/constitutions"
import { getAtlasReportData } from "@/lib/reports/atlas-report-data"
import { AtlasReportPdf } from "@/components/reports/atlas-report-pdf"
import type { ReportPeriod } from "@/lib/reports/pdf-theme"

const VALID_PERIODS: ReportPeriod[] = ["monthly", "quarterly", "annual"]

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  if (constitutionIdForEmail(session.email) !== "atlas-core") {
    return NextResponse.json({ error: "Not available for this portfolio" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const periodParam = searchParams.get("period") ?? "monthly"
  if (!VALID_PERIODS.includes(periodParam as ReportPeriod)) {
    return NextResponse.json({ error: "Invalid period — use monthly, quarterly, or annual" }, { status: 400 })
  }
  const period = periodParam as ReportPeriod

  const data = await getAtlasReportData(session.userId, period)
  const buffer = await renderToBuffer(<AtlasReportPdf data={data} />)

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="atlas-core-${period}-report-${today()}.pdf"`,
    },
  })
}

function today(): string {
  return new Date().toISOString().split("T")[0]
}
