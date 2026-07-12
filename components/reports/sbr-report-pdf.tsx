import { formatCurrency } from "@/lib/utils"
import { SBR_REPORT_THEME, PERIOD_COMPARISON_LABEL } from "@/lib/reports/pdf-theme"
import type { SbrReportData } from "@/lib/reports/sbr-report-data"
import { SBR_TECHNOLOGY_LIMIT, SBR_SINGLE_COMPANY_LIMIT } from "@/lib/sbr-look-through"
import { ReportPdf, CoverPage, ContentPage, SectionHeading, StatGrid, DataTable, Callout, BodyText, type StatItem } from "@/components/reports/pdf/kit"

function statusTone(status: "ok" | "watch" | "breach"): "good" | "warning" | "critical" {
  if (status === "breach") return "critical"
  if (status === "watch") return "warning"
  return "good"
}

export function SbrReportPdf({ data }: { data: SbrReportData }) {
  const theme = SBR_REPORT_THEME
  const changeLabel = data.valueChangePct !== null
    ? `${data.valueChangePct >= 0 ? "+" : ""}${data.valueChangePct.toFixed(1)}% vs ${PERIOD_COMPARISON_LABEL[data.period]}`
    : "No comparison snapshot yet"

  const healthStats: StatItem[] = [
    { label: "Overall Standing", value: `${data.health.overall}`, sub: data.health.overallLabel, tone: statusTone(data.health.overall >= 80 ? "ok" : data.health.overall >= 65 ? "watch" : "breach") },
    { label: "Drift Alerts", value: `${data.driftAlerts}`, sub: `${data.hardBreaches} over limit · ${data.softBreaches} out of range`, tone: data.driftAlerts === 0 ? "good" : data.hardBreaches > 0 ? "critical" : "warning" },
    { label: "Rules Followed", value: data.governance.overall === "ok" ? "Clear" : data.governance.overall === "watch" ? "Watch" : "Breach", sub: `${data.governance.breaches} breach · ${data.governance.watches} watch`, tone: statusTone(data.governance.overall) },
    { label: "Biggest Drift", value: `${data.maxDrift.toFixed(1)}%`, sub: "Largest gap from target", tone: data.maxDrift > 5 ? "warning" : "good" },
  ]

  const topCompanies = data.lookThrough.companies.slice(0, 8)

  return (
    <ReportPdf title={`Silicon Brick Road — ${data.periodLabel}`}>
      <CoverPage
        theme={theme}
        reportLabel="Flexible Growth Portfolio Report"
        periodLabel={data.periodLabel}
        generatedOn={data.generatedOn}
        heroLabel="Current Portfolio Value"
        heroValue={formatCurrency(data.totalValue, "SGD")}
        heroSub={changeLabel}
      />

      <ContentPage theme={theme} pageLabel={data.periodLabel}>
        <SectionHeading theme={theme} title="What's Happening" subtitle="Plain-English summary of the plan right now" />
        <StatGrid items={healthStats} />
        <Callout tone={data.hardBreaches > 0 ? "critical" : data.softBreaches > 0 ? "warning" : "good"}>
          {data.hardBreaches > 0
            ? `${data.hardBreaches} fund${data.hardBreaches > 1 ? "s are" : " is"} over its limit and needs action this month.`
            : data.softBreaches > 0
              ? `${data.softBreaches} fund${data.softBreaches > 1 ? "s have" : " has"} drifted outside its comfortable range — the next contribution should fix it, no selling needed.`
              : "Every fund is within its comfortable range. Nothing to fix."}
        </Callout>

        <SectionHeading theme={theme} title="What's Changed" subtitle={data.periodAgoValue !== null ? `Since ${PERIOD_COMPARISON_LABEL[data.period]}` : "No prior snapshot is available yet"} />
        {data.periodAgoValue !== null ? (
          <BodyText>
            The portfolio moved from {formatCurrency(data.periodAgoValue, "SGD")} to {formatCurrency(data.totalValue, "SGD")}
            {" "}({data.valueChangeAbs! >= 0 ? "+" : ""}{formatCurrency(data.valueChangeAbs!, "SGD")}, {data.valueChangePct!.toFixed(1)}%).
          </BodyText>
        ) : (
          <BodyText>Not enough price history yet to compare against this period — check back after the next snapshot.</BodyText>
        )}
        <BodyText style={{ color: "#6b6b7d" }}>Flexible growth mode · no fixed end date.</BodyText>

        <SectionHeading theme={theme} title="What Needs to Be Done" subtitle="Silicon Brick Road decision steps" />
        <Callout tone={data.nextMove.severity === "critical" || data.nextMove.severity === "high" ? "critical" : data.nextMove.severity === "medium" ? "warning" : "good"}>
          {data.nextMove.action}. {data.nextMove.what}
        </Callout>
        <BodyText style={{ color: "#6b6b7d" }}>{data.nextMove.why}</BodyText>
        <BodyText style={{ color: "#6b6b7d" }}>Timing: {data.nextMove.when}</BodyText>
      </ContentPage>

      <ContentPage theme={theme} pageLabel={data.periodLabel}>
        <SectionHeading theme={theme} title="What's Owned" subtitle="Current holdings vs the target split" />
        <DataTable
          theme={theme}
          columns={[
            { header: "Fund", width: "16%", render: (r: typeof data.positions[number]) => r.ticker },
            { header: "Value", width: "22%", align: "right", render: (r) => formatCurrency(r.value, "SGD") },
            { header: "Actual", width: "16%", align: "right", render: (r) => `${r.actualPct.toFixed(1)}%` },
            { header: "Target", width: "16%", align: "right", render: (r) => `${r.targetPct.toFixed(1)}%` },
            { header: "Drift", width: "15%", align: "right", render: (r) => `${r.drift >= 0 ? "+" : ""}${r.drift.toFixed(1)}%` },
            { header: "Status", width: "15%", align: "right", render: (r) => r.status === "hard" ? "Over limit" : r.status === "soft" ? "Drift" : "Healthy", color: (r) => r.status === "hard" ? "#dc2626" : r.status === "soft" ? "#d97706" : "#16a34a" },
          ]}
          rows={data.positions}
        />

        <SectionHeading theme={theme} title="Underlying Look-Through" subtitle="What the four funds really hold once you look inside them" />
        <Callout tone={data.lookThrough.technologyOver ? "critical" : data.lookThrough.technologyPct > SBR_TECHNOLOGY_LIMIT - 3 ? "warning" : "good"}>
          Technology works out to about {data.lookThrough.technologyPct.toFixed(0)}% once you look inside the funds (limit {SBR_TECHNOLOGY_LIMIT}%).
        </Callout>
        <DataTable
          theme={theme}
          columns={[
            { header: "Company", width: "45%", render: (r: typeof topCompanies[number]) => r.name },
            { header: "Effective %", width: "25%", align: "right", render: (r) => `${r.pct.toFixed(1)}%` },
            { header: "Status", width: "30%", align: "right", render: (r) => r.pct > SBR_SINGLE_COMPANY_LIMIT ? "Over limit" : r.pct > SBR_SINGLE_COMPANY_LIMIT - 2 ? "Watch" : "OK", color: (r) => r.pct > SBR_SINGLE_COMPANY_LIMIT ? "#dc2626" : r.pct > SBR_SINGLE_COMPANY_LIMIT - 2 ? "#d97706" : "#16a34a" },
          ]}
          rows={topCompanies}
        />

        <SectionHeading theme={theme} title="Rules Check" subtitle="Every plan rule, checked against the current portfolio" />
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
