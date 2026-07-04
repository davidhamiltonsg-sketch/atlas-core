import { formatCurrency } from "@/lib/utils"
import { ATLAS_REPORT_THEME, PERIOD_COMPARISON_LABEL } from "@/lib/reports/pdf-theme"
import type { AtlasReportData } from "@/lib/reports/atlas-report-data"
import { ReportPdf, CoverPage, ContentPage, SectionHeading, StatGrid, DataTable, Callout, BodyText, type StatItem } from "@/components/reports/pdf/kit"

function statusTone(status: "healthy" | "soft" | "hard" | "ok" | "watch" | "breach"): "good" | "warning" | "critical" {
  if (status === "hard" || status === "breach") return "critical"
  if (status === "soft" || status === "watch") return "warning"
  return "good"
}

export function AtlasReportPdf({ data }: { data: AtlasReportData }) {
  const theme = ATLAS_REPORT_THEME
  const changeLabel = data.valueChangePct !== null
    ? `${data.valueChangePct >= 0 ? "+" : ""}${data.valueChangePct.toFixed(1)}% vs ${PERIOD_COMPARISON_LABEL[data.period]}`
    : "No comparison snapshot yet"

  const healthStats: StatItem[] = [
    { label: "Overall Health", value: `${data.health.overall}`, sub: data.health.overallLabel, tone: statusTone(data.health.overall >= 75 ? "healthy" : data.health.overall >= 55 ? "soft" : "hard") },
    { label: "Drift Alerts", value: `${data.driftAlerts}`, sub: `${data.hardBreaches} hard · ${data.softBreaches} soft`, tone: data.driftAlerts === 0 ? "good" : data.hardBreaches > 0 ? "critical" : "warning" },
    { label: "Compliance", value: data.governance.overall === "ok" ? "Clear" : data.governance.overall === "watch" ? "Watch" : "Breach", sub: `${data.governance.breaches} breach · ${data.governance.watches} watch`, tone: statusTone(data.governance.overall) },
    { label: "Max Drift", value: `${data.maxDrift.toFixed(1)}%`, sub: "Largest gap from target", tone: data.maxDrift > 5 ? "warning" : "good" },
  ]

  const topExposures = [...data.lookThrough.companies, ...data.lookThrough.sectors]
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 8)

  return (
    <ReportPdf title={`Atlas Core — ${data.periodLabel}`}>
      <CoverPage
        theme={theme}
        reportLabel="Portfolio Report"
        periodLabel={data.periodLabel}
        generatedOn={data.generatedOn}
        heroLabel="Total Portfolio Value"
        heroValue={formatCurrency(data.totalValue, "SGD")}
        heroSub={changeLabel}
      />

      <ContentPage theme={theme} pageLabel={data.periodLabel}>
        <SectionHeading theme={theme} title="What's Happening" subtitle="Plain-English summary of the portfolio right now" />
        <StatGrid items={healthStats} />
        <Callout tone={data.hardBreaches > 0 ? "critical" : data.softBreaches > 0 ? "warning" : "good"}>
          {data.hardBreaches > 0
            ? `${data.hardBreaches} position${data.hardBreaches > 1 ? "s are" : " is"} over its hard limit and needs action this dealing window.`
            : data.softBreaches > 0
              ? `${data.softBreaches} position${data.softBreaches > 1 ? "s have" : " has"} drifted outside its comfortable range — redirect contributions, no selling needed.`
              : "Every position is within its healthy range. No corrective action needed."}
        </Callout>

        <SectionHeading theme={theme} title="What's Changed" subtitle={data.periodAgoValue !== null ? `Since ${PERIOD_COMPARISON_LABEL[data.period]}` : "No prior snapshot is available yet"} />
        {data.periodAgoValue !== null ? (
          <BodyText>
            Portfolio value moved from {formatCurrency(data.periodAgoValue, "SGD")} to {formatCurrency(data.totalValue, "SGD")}
            {" "}({data.valueChangeAbs! >= 0 ? "+" : ""}{formatCurrency(data.valueChangeAbs!, "SGD")}, {data.valueChangePct!.toFixed(1)}%).
          </BodyText>
        ) : (
          <BodyText>Not enough price history yet to compare against this period — check back after the next snapshot.</BodyText>
        )}

        <SectionHeading theme={theme} title="What Needs to Be Done" subtitle={`Art. XIII Decision Ladder — ${data.nextMove.citation}`} />
        <Callout tone={data.nextMove.severity === "critical" || data.nextMove.severity === "high" ? "critical" : data.nextMove.severity === "medium" ? "warning" : "good"}>
          {data.nextMove.headline}. {data.nextMove.instruction}
        </Callout>
        <BodyText style={{ color: "#6b6b7d" }}>{data.nextMove.rationale}</BodyText>
        <BodyText style={{ color: "#6b6b7d" }}>Timing: {data.nextMove.when}</BodyText>
      </ContentPage>

      <ContentPage theme={theme} pageLabel={data.periodLabel}>
        <SectionHeading theme={theme} title="What's Owned" subtitle="Current holdings vs target allocation" />
        <DataTable
          theme={theme}
          columns={[
            { header: "Ticker", width: "16%", render: (r: typeof data.positions[number]) => r.ticker },
            { header: "Value", width: "22%", align: "right", render: (r) => formatCurrency(r.value, "SGD") },
            { header: "Actual", width: "16%", align: "right", render: (r) => `${r.actualPct.toFixed(1)}%` },
            { header: "Target", width: "16%", align: "right", render: (r) => `${r.targetPct.toFixed(1)}%` },
            { header: "Drift", width: "15%", align: "right", render: (r) => `${r.drift >= 0 ? "+" : ""}${r.drift.toFixed(1)}%` },
            { header: "Status", width: "15%", align: "right", render: (r) => r.status === "hard" ? "Breach" : r.status === "soft" ? "Drift" : "Healthy", color: (r) => r.status === "hard" ? "#dc2626" : r.status === "soft" ? "#d97706" : "#16a34a" },
          ]}
          rows={data.positions}
        />

        <SectionHeading theme={theme} title="Underlying Look-Through" subtitle="True exposure once overlapping funds are counted through to their holdings" />
        <DataTable
          theme={theme}
          columns={[
            { header: "Exposure", width: "40%", render: (r: typeof topExposures[number]) => r.label },
            { header: "Effective %", width: "20%", align: "right", render: (r) => `${r.pct.toFixed(1)}%` },
            { header: "Soft / Hard Limit", width: "25%", align: "right", render: (r) => `${r.soft}% / ${r.hard}%` },
            { header: "Status", width: "15%", align: "right", render: (r) => r.status === "breach" ? "Breach" : r.status === "watch" ? "Watch" : "OK", color: (r) => r.status === "breach" ? "#dc2626" : r.status === "watch" ? "#d97706" : "#16a34a" },
          ]}
          rows={topExposures}
        />

        <SectionHeading theme={theme} title="Compliance Check" subtitle="Every governance rule, evaluated against the current portfolio" />
        <DataTable
          theme={theme}
          columns={[
            { header: "Rule", width: "35%", render: (r: typeof data.governance.checks[number]) => r.label },
            { header: "Status", width: "15%", align: "right", render: (r) => r.status === "breach" ? "Breach" : r.status === "watch" ? "Watch" : "OK", color: (r) => r.status === "breach" ? "#dc2626" : r.status === "watch" ? "#d97706" : "#16a34a" },
            { header: "Detail", width: "50%", render: (r) => r.detail },
          ]}
          rows={data.governance.checks}
        />
      </ContentPage>
    </ReportPdf>
  )
}
