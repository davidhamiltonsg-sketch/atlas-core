import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { getSession } from "@/lib/session"
import { constitutionIdForEmail } from "@/lib/constitutions"
import { getSbrReportData } from "@/lib/reports/sbr-report-data"
import { SbrReportPdf } from "@/components/reports/sbr-report-pdf"
import type { ReportPeriod } from "@/lib/reports/pdf-theme"

const VALID_PERIODS: ReportPeriod[] = ["monthly", "quarterly", "annual"]

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  if (constitutionIdForEmail(session.email) !== "silicon-brick-road") {
    return NextResponse.json({ error: "Not available for this portfolio" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const periodParam = searchParams.get("period") ?? "monthly"
  if (!VALID_PERIODS.includes(periodParam as ReportPeriod)) {
    return NextResponse.json({ error: "Invalid period — use monthly, quarterly, or annual" }, { status: 400 })
  }
  const period = periodParam as ReportPeriod

  const data = await getSbrReportData(session.userId, period)
  const buffer = await renderToBuffer(<SbrReportPdf data={data} />)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="silicon-brick-road-${period}-report-${today()}.pdf"`,
    },
  })
}

function today(): string {
  return new Date().toISOString().split("T")[0]
}
