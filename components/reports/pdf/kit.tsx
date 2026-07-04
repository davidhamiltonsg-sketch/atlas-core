import { Document, Page, View, Text, StyleSheet, Svg, Path, Defs, LinearGradient, Stop } from "@react-pdf/renderer"
import type { ReportTheme } from "@/lib/reports/pdf-theme"

// Shared, portfolio-neutral PDF report kit. Takes a ReportTheme (colors + name only) and
// renders a consistent "premium" document shell — cover page, running header/footer, section
// headings, stat grids, data tables, callouts — for either portfolio. No ticker/logic
// awareness lives here; each portfolio's own report-data module supplies the content.
//
// Standard PDF fonts (Helvetica/Helvetica-Bold/Courier) are used rather than the web app's
// Fraunces/Geist/IBM Plex Mono — react-pdf can't share next/font's self-hosted font files
// without a separate font-fetch step, and this avoids a network dependency at render time.
// The premium feel comes from color, spacing, rules, and information density instead.

const SHIELD_PATH =
  "M32 3.5C38.4 6.4 46.9 8.2 54.9 8.8C56.1 8.9 57 9.9 57 11.1V29C57 45.4 46.5 55.6 32.9 60.3C32.3 60.5 31.7 60.5 31.1 60.3C17.5 55.6 7 45.4 7 29V11.1C7 9.9 7.9 8.9 9.1 8.8C17.1 8.2 25.6 6.4 32 3.5Z"

function Crest({ theme, size = 64 }: { theme: ReportTheme; size?: number }) {
  return (
    <Svg viewBox="0 0 64 64" style={{ width: size, height: size }}>
      <Defs>
        <LinearGradient id="crestFill" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={theme.brandA} />
          <Stop offset="1" stopColor={theme.brandC} />
        </LinearGradient>
      </Defs>
      <Path d={SHIELD_PATH} fill="url(#crestFill)" stroke={theme.brandB} strokeWidth={1.6} />
    </Svg>
  )
}

const base = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: "#1a1a2e",
    paddingTop: 42,
    paddingBottom: 48,
    paddingHorizontal: 40,
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 40,
    paddingTop: 10,
    borderBottomWidth: 0.75,
    borderBottomColor: "#e5e5ef",
  },
  headerText: { fontSize: 8, color: "#6b6b7d" },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 40,
    paddingBottom: 14,
  },
  footerText: { fontSize: 7.5, color: "#9999a8" },
})

export function ReportPdf({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Document title={title} author="Atlas Universe" creator="Atlas Universe">
      {children}
    </Document>
  )
}

export function CoverPage({
  theme,
  reportLabel,
  periodLabel,
  generatedOn,
  heroLabel,
  heroValue,
  heroSub,
}: {
  theme: ReportTheme
  reportLabel: string
  periodLabel: string
  generatedOn: string
  heroLabel: string
  heroValue: string
  heroSub: string
}) {
  const styles = StyleSheet.create({
    page: {
      fontFamily: "Helvetica",
      backgroundColor: "#0c0a14",
      color: "#ffffff",
      padding: 56,
      justifyContent: "space-between",
    },
    eyebrow: { fontSize: 9, letterSpacing: 3, color: theme.brandC, textTransform: "uppercase", marginBottom: 10 },
    portfolioName: { fontSize: 30, fontFamily: "Helvetica-Bold", marginBottom: 6 },
    reportLabel: { fontSize: 14, color: "#c9c9dc", marginBottom: 2 },
    period: { fontSize: 11, color: "#8f8fa8" },
    heroBlock: { marginTop: 30 },
    heroLabelText: { fontSize: 9, color: "#8f8fa8", textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 },
    heroValueText: { fontSize: 40, fontFamily: "Helvetica-Bold", color: theme.brandC },
    heroSubText: { fontSize: 9.5, color: "#a8a8c0", marginTop: 4 },
    footerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
    footerText: { fontSize: 8, color: "#6b6b80" },
  })
  return (
    <Page size="A4" style={styles.page}>
      <View>
        <Crest theme={theme} size={52} />
        <View style={{ marginTop: 24 }}>
          <Text style={styles.eyebrow}>Atlas Universe</Text>
          <Text style={styles.portfolioName}>{theme.portfolioName}</Text>
          <Text style={styles.reportLabel}>{reportLabel}</Text>
          <Text style={styles.period}>{periodLabel}</Text>
        </View>
        <View style={styles.heroBlock}>
          <Text style={styles.heroLabelText}>{heroLabel}</Text>
          <Text style={styles.heroValueText}>{heroValue}</Text>
          <Text style={styles.heroSubText}>{heroSub}</Text>
        </View>
      </View>
      <View style={styles.footerRow}>
        <Text style={styles.footerText}>Generated {generatedOn}</Text>
        <Text style={styles.footerText}>Confidential — for the account holder only</Text>
      </View>
    </Page>
  )
}

export function ContentPage({
  theme,
  pageLabel,
  children,
}: {
  theme: ReportTheme
  pageLabel: string
  children: React.ReactNode
}) {
  return (
    <Page size="A4" style={base.page} wrap>
      <View style={base.header} fixed>
        <Text style={[base.headerText, { color: theme.primary, fontFamily: "Helvetica-Bold" }]}>{theme.portfolioName}</Text>
        <Text style={base.headerText}>{pageLabel}</Text>
      </View>
      <View>{children}</View>
      <View style={base.footer} fixed>
        <Text style={base.footerText}>Atlas Universe</Text>
        <Text
          style={base.footerText}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </View>
    </Page>
  )
}

export function SectionHeading({ theme, title, subtitle }: { theme: ReportTheme; title: string; subtitle?: string }) {
  const styles = StyleSheet.create({
    wrap: { marginTop: 18, marginBottom: 10 },
    rule: { height: 2, width: 28, backgroundColor: theme.primary, marginBottom: 6 },
    title: { fontSize: 13, fontFamily: "Helvetica-Bold", color: "#141420" },
    subtitle: { fontSize: 8.5, color: "#7a7a8c", marginTop: 2 },
  })
  return (
    <View style={styles.wrap}>
      <View style={styles.rule} />
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  )
}

export interface StatItem {
  label: string
  value: string
  sub?: string
  tone?: "good" | "warning" | "critical" | "neutral"
}

const TONE_COLOR: Record<NonNullable<StatItem["tone"]>, string> = {
  good: "#16a34a",
  warning: "#d97706",
  critical: "#dc2626",
  neutral: "#141420",
}

export function StatGrid({ items }: { items: StatItem[] }) {
  const styles = StyleSheet.create({
    grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 },
    cell: { width: "25%", paddingHorizontal: 4, marginBottom: 10 },
    card: { borderWidth: 0.75, borderColor: "#e5e5ef", borderRadius: 4, padding: 8 },
    label: { fontSize: 7, textTransform: "uppercase", letterSpacing: 1, color: "#8a8a9c", marginBottom: 4 },
    value: { fontSize: 14, fontFamily: "Courier-Bold" },
    sub: { fontSize: 7, color: "#9a9aac", marginTop: 2 },
  })
  return (
    <View style={styles.grid}>
      {items.map((it, i) => (
        <View key={i} style={styles.cell}>
          <View style={styles.card}>
            <Text style={styles.label}>{it.label}</Text>
            <Text style={[styles.value, { color: TONE_COLOR[it.tone ?? "neutral"] }]}>{it.value}</Text>
            {it.sub && <Text style={styles.sub}>{it.sub}</Text>}
          </View>
        </View>
      ))}
    </View>
  )
}

export interface TableColumn<T> {
  header: string
  width?: string | number
  align?: "left" | "right" | "center"
  render: (row: T) => string
  color?: (row: T) => string | undefined
}

export function DataTable<T>({ columns, rows, theme }: { columns: TableColumn<T>[]; rows: T[]; theme: ReportTheme }) {
  const styles = StyleSheet.create({
    table: { borderWidth: 0.75, borderColor: "#e5e5ef", borderRadius: 3, marginTop: 4 },
    headRow: { flexDirection: "row", backgroundColor: "#f6f5fb", borderBottomWidth: 0.75, borderBottomColor: "#e5e5ef" },
    row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#eeeef4" },
    headCell: { padding: 5, fontSize: 7, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.5, color: theme.primary },
    cell: { padding: 5, fontSize: 8.25 },
  })
  return (
    <View style={styles.table} wrap={false}>
      <View style={styles.headRow}>
        {columns.map((c, i) => (
          <Text key={i} style={[styles.headCell, { width: c.width ?? `${100 / columns.length}%`, textAlign: c.align ?? "left" }]}>
            {c.header}
          </Text>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={styles.row}>
          {columns.map((c, ci) => (
            <Text
              key={ci}
              style={[styles.cell, { width: c.width ?? `${100 / columns.length}%`, textAlign: c.align ?? "left", color: c.color?.(r) ?? "#1a1a2e" }]}
            >
              {c.render(r)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  )
}

export function Callout({
  tone = "neutral",
  children,
}: {
  tone?: "good" | "warning" | "critical" | "neutral"
  children: React.ReactNode
}) {
  const bg = { good: "#f0fdf4", warning: "#fffbeb", critical: "#fef2f2", neutral: "#f6f5fb" }[tone]
  const border = { good: "#bbf7d0", warning: "#fde68a", critical: "#fecaca", neutral: "#e5e5ef" }[tone]
  const styles = StyleSheet.create({
    box: { backgroundColor: bg, borderWidth: 0.75, borderColor: border, borderRadius: 3, padding: 8, marginTop: 6, marginBottom: 6 },
    text: { fontSize: 8.5, lineHeight: 1.5, color: "#2a2a3a" },
  })
  return (
    <View style={styles.box}>
      <Text style={styles.text}>{children}</Text>
    </View>
  )
}

export function BodyText({ children, style }: { children: React.ReactNode; style?: object }) {
  const merged = { fontSize: 8.75, lineHeight: 1.55, color: "#2a2a3a", marginBottom: 4, ...style }
  return <Text style={merged}>{children}</Text>
}
