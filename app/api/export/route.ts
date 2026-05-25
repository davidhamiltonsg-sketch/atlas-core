"use server"

import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"

// ─── CSV helper ────────────────────────────────────────────────────────────────

function toCSV(headers: string[], rows: (string | number | null)[][]): string {
  const escape = (v: string | number | null) => {
    if (v === null || v === undefined) return ""
    const s = String(v)
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const lines = [headers.join(","), ...rows.map(r => r.map(escape).join(","))]
  return lines.join("\r\n")
}

// ─── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const type = searchParams.get("type") ?? "portfolio"

  let csv = ""
  let filename = ""

  if (type === "portfolio") {
    // Latest snapshot per holding
    const holdings = await db.holding.findMany({
      where: { userId: session.userId },
      include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
      orderBy: { targetPct: "desc" },
    })
    const rows = holdings.map(h => {
      const snap = h.snapshots[0]
      return [
        h.ticker,
        h.name,
        h.targetPct,
        h.hardCapPct ?? "",
        snap?.units ?? "",
        snap?.price ?? "",
        snap?.value ?? "",
        snap?.date.toISOString().split("T")[0] ?? "",
      ]
    })
    csv = toCSV(
      ["Ticker", "Name", "Target %", "Hard Cap %", "Units", "Price (USD)", "Value (SGD)", "Snapshot Date"],
      rows
    )
    filename = `atlas-portfolio-${today()}.csv`

  } else if (type === "snapshots") {
    // All snapshots
    const holdings = await db.holding.findMany({
      where: { userId: session.userId },
      include: { snapshots: { orderBy: { date: "asc" } } },
    })
    const rows: (string | number)[][] = []
    for (const h of holdings) {
      for (const s of h.snapshots) {
        rows.push([
          s.date.toISOString().split("T")[0],
          h.ticker,
          h.name,
          s.units,
          s.price,
          s.value,
        ])
      }
    }
    csv = toCSV(
      ["Date", "Ticker", "Name", "Units", "Price (USD)", "Value (SGD)"],
      rows
    )
    filename = `atlas-snapshots-${today()}.csv`

  } else if (type === "trades") {
    const trades = await db.trade.findMany({
      where: { userId: session.userId },
      orderBy: { date: "desc" },
    })
    const rows = trades.map(t => [
      t.date.toISOString().split("T")[0],
      t.ticker,
      t.type,
      t.units,
      t.price,
      t.fxRate,
      t.amount,
      t.note ?? "",
    ])
    csv = toCSV(
      ["Date", "Ticker", "Type", "Units", "Price (USD)", "FX Rate (USDSGD)", "Amount (SGD)", "Note"],
      rows
    )
    filename = `atlas-trades-${today()}.csv`

  } else if (type === "contributions") {
    const contribs = await db.contributionRecord.findMany({
      where: { userId: session.userId },
      orderBy: { date: "desc" },
    })
    const rows = contribs.map(c => [
      c.date.toISOString().split("T")[0],
      c.amount,
      c.note ?? "",
    ])
    csv = toCSV(["Date", "Amount (USD)", "Note"], rows)
    filename = `atlas-contributions-${today()}.csv`

  } else if (type === "dividends") {
    const dividends = await db.dividend.findMany({
      where: { userId: session.userId },
      orderBy: { paymentDate: "desc" },
    })
    const rows = dividends.map(d => [
      d.paymentDate.toISOString().split("T")[0],
      d.ticker,
      d.amount,
      d.units,
      (d.amount / Math.max(d.units, 0.0001)).toFixed(4),
      d.note ?? "",
    ])
    csv = toCSV(["Payment Date", "Ticker", "Amount (SGD)", "Units Held", "Per Unit (SGD)", "Note"], rows)
    filename = `atlas-dividends-${today()}.csv`

  } else {
    return NextResponse.json({ error: "Unknown export type" }, { status: 400 })
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}

function today(): string {
  return new Date().toISOString().split("T")[0]
}
