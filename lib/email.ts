import { Resend } from "resend"
import type { DigestItem } from "@/lib/governance-digest"
import type { NextMove } from "@/lib/next-best-move"

// Lazy — instantiating Resend with no key throws, which would break the build when a
// route that imports this module is statically analysed. Only create it when actually sending.
function getResend(): Resend {
  return new Resend(process.env.RESEND_API_KEY)
}

const FROM = process.env.EMAIL_FROM ?? "Atlas Core <onboarding@resend.dev>"
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

const SEVERITY_STYLE: Record<DigestItem["severity"], { color: string; bg: string; label: string }> = {
  breach: { color: "#dc2626", bg: "#fef2f2", label: "Action needed" },
  watch:  { color: "#d97706", bg: "#fffbeb", label: "Review" },
  info:   { color: "#7c3aed", bg: "#f5f3ff", label: "Reminder" },
}

/**
 * Daily governance digest — the notification that closes the loop. Sent by the scheduled
 * job only when there is something worth acting on, so it never becomes noise.
 */
export async function sendGovernanceDigestEmail(
  toEmail: string,
  toName: string,
  items: DigestItem[],
) {
  if (!emailConfigured()) return { skipped: true as const, reason: "RESEND_API_KEY not set" }

  const breaches = items.filter((i) => i.severity === "breach").length
  const subject = breaches > 0
    ? `Atlas Core — ${breaches} rule${breaches > 1 ? "s" : ""} need attention`
    : "Atlas Core — your portfolio check-in"

  const rows = items.map((i) => {
    const s = SEVERITY_STYLE[i.severity]
    return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #eee;">
          <span style="display:inline-block;font-size:10px;font-weight:700;color:${s.color};background:${s.bg};border-radius:6px;padding:3px 8px;text-transform:uppercase;letter-spacing:0.5px;">${s.label}</span>
          <div style="font-size:14px;font-weight:600;color:#1a1a2e;margin-top:6px;">${i.title}</div>
          <div style="font-size:13px;color:#6b6b8a;line-height:1.5;margin-top:2px;">${i.detail}</div>
        </td>
      </tr>`
  }).join("")

  const { error } = await getResend().emails.send({
    from: FROM,
    to: toEmail,
    subject,
    html: `
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f4f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;"><tr><td align="center">
    <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e2e2ee;overflow:hidden;">
      <tr><td style="padding:28px 32px 20px;border-bottom:1px solid #e2e2ee;">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="background:linear-gradient(135deg,#8b5cf6,#7c3aed);border-radius:12px;width:40px;height:40px;text-align:center;vertical-align:middle;">
            <span style="color:#ffffff;font-size:13px;font-weight:900;letter-spacing:-0.5px;">AC</span></td>
          <td style="padding-left:12px;"><div style="font-size:15px;font-weight:700;color:#1a1a2e;">Atlas Core</div>
            <div style="font-size:11px;color:#6b6b8a;margin-top:1px;">Daily governance check</div></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px 32px;">
        <p style="margin:0 0 16px;font-size:14px;color:#6b6b8a;line-height:1.6;">Hi ${toName}, here's what your rules flagged today:</p>
        <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
        <table cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr>
          <td style="background:#7c3aed;border-radius:10px;">
            <a href="${APP_URL}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Open Atlas Core</a>
          </td></tr></table>
      </td></tr>
      <tr><td style="padding:16px 32px;border-top:1px solid #e2e2ee;background:#f9f9fc;">
        <p style="margin:0;font-size:11px;color:#9999b3;">You're getting this because your portfolio needs attention. No action means nothing changed — that's fine too.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`.trim(),
  })

  if (error) throw new Error(error.message)
  return { skipped: false as const }
}

// ─── SBR — Daily Digest ────────────────────────────────────────────────────
/**
 * Daily governance digest for Dami's Silicon Brick Road portfolio.
 * Sky-blue branding. Only sent when actionable.
 */
export async function sendSbrDigestEmail(
  toEmail: string,
  toName: string,
  items: DigestItem[],
  nextMove: NextMove,
  phase: { key: string; label: string },
  totalValue: number,
) {
  if (!emailConfigured()) return { skipped: true as const, reason: "RESEND_API_KEY not set" }

  const breaches = items.filter((i) => i.severity === "breach").length
  const subject = breaches > 0
    ? `Road Report — ${breaches} rule${breaches > 1 ? "s" : ""} need attention`
    : "Road Report — your monthly contribution window"

  const rows = items.map((i) => {
    const s = SEVERITY_STYLE[i.severity]
    return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #eee;">
          <span style="display:inline-block;font-size:10px;font-weight:700;color:${s.color};background:${s.bg};border-radius:6px;padding:3px 8px;text-transform:uppercase;letter-spacing:0.5px;">${s.label}</span>
          <div style="font-size:14px;font-weight:600;color:#1a1a2e;margin-top:6px;">${i.title}</div>
          <div style="font-size:13px;color:#6b6b8a;line-height:1.5;margin-top:2px;">${i.detail}</div>
        </td>
      </tr>`
  }).join("")

  const moveColor = nextMove.severity === "critical" ? "#dc2626" : nextMove.severity === "high" ? "#d97706" : "#0284c7"

  const { error } = await getResend().emails.send({
    from: FROM,
    to: toEmail,
    subject,
    html: `
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f0f9ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;"><tr><td align="center">
    <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #bae6fd;overflow:hidden;">
      <tr><td style="padding:28px 32px 20px;border-bottom:1px solid #e0f2fe;">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="background:linear-gradient(135deg,#38bdf8,#0284c7);border-radius:12px;width:40px;height:40px;text-align:center;vertical-align:middle;">
            <span style="color:#ffffff;font-size:11px;font-weight:900;letter-spacing:-0.5px;">SBR</span></td>
          <td style="padding-left:12px;"><div style="font-size:15px;font-weight:700;color:#0c4a6e;">Silicon Brick Road</div>
            <div style="font-size:11px;color:#0369a1;margin-top:1px;">Phase ${phase.key} · SGD ${Math.round(totalValue).toLocaleString()}</div></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:20px 32px;background:#f0f9ff;border-bottom:1px solid #e0f2fe;">
        <div style="font-size:11px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">This month's move</div>
        <div style="font-size:16px;font-weight:700;color:${moveColor};">${nextMove.action}</div>
        <div style="font-size:13px;color:#475569;margin-top:4px;line-height:1.5;">${nextMove.what}</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px;font-style:italic;">${nextMove.when}</div>
      </td></tr>
      <tr><td style="padding:28px 32px;">
        <p style="margin:0 0 16px;font-size:14px;color:#6b6b8a;line-height:1.6;">Hi ${toName}, here's what your rules flagged:</p>
        <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
        <table cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr>
          <td style="background:#0284c7;border-radius:10px;">
            <a href="${APP_URL}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Open Road Report</a>
          </td></tr></table>
      </td></tr>
      <tr><td style="padding:16px 32px;border-top:1px solid #e0f2fe;background:#f0f9ff;">
        <p style="margin:0;font-size:11px;color:#0369a1;">Silicon Brick Road — flexible medium-term growth. Discipline over prediction.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`.trim(),
  })

  if (error) throw new Error(error.message)
  return { skipped: false as const }
}

// ─── Monthly Contribution Reminder — both portfolios ──────────────────────
/**
 * "What to buy this month" email — sent on the 14th before the dealing window opens.
 * Produces a clear one-action card so there's no ambiguity on the 15th.
 */
export async function sendMonthlyReminderEmail(
  toEmail: string,
  toName: string,
  portfolio: "atlas-core" | "silicon-brick-road",
  nextMove: NextMove,
  dealingWindow?: { opens: string; closes: string },
) {
  if (!emailConfigured()) return { skipped: true as const, reason: "RESEND_API_KEY not set" }

  const isAtlas = portfolio === "atlas-core"
  const primaryColor = isAtlas ? "#7c3aed" : "#0284c7"
  const bgColor = isAtlas ? "#f4f4f8" : "#f0f9ff"
  const borderColor = isAtlas ? "#e2e2ee" : "#bae6fd"
  const accentBg = isAtlas ? "#f5f3ff" : "#e0f2fe"
  const moniker = isAtlas ? "AC" : "SBR"
  const portfolioName = isAtlas ? "Atlas Core" : "Silicon Brick Road"
  const tagline = isAtlas ? "Investment Constitution v3.1" : "Flexible medium-term growth · Constitution v3.2"
  const severityColor = nextMove.severity === "critical" ? "#dc2626"
    : nextMove.severity === "high" ? "#d97706"
    : nextMove.severity === "medium" ? "#0284c7"
    : primaryColor

  const windowRow = dealingWindow
    ? `<tr><td style="padding:10px 0;border-top:1px solid ${borderColor};">
        <span style="font-size:12px;color:#6b6b8a;">Dealing window: </span>
        <span style="font-size:12px;font-weight:600;color:#1a1a2e;">${dealingWindow.opens} → ${dealingWindow.closes}</span>
      </td></tr>`
    : ""

  const { error } = await getResend().emails.send({
    from: FROM,
    to: toEmail,
    subject: `${portfolioName} — your ${new Date().toLocaleString("en-SG", { month: "long" })} contribution`,
    html: `
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:${bgColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;"><tr><td align="center">
    <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid ${borderColor};overflow:hidden;">
      <tr><td style="padding:28px 32px 20px;border-bottom:1px solid ${borderColor};">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="background:${primaryColor};border-radius:12px;width:40px;height:40px;text-align:center;vertical-align:middle;">
            <span style="color:#ffffff;font-size:11px;font-weight:900;letter-spacing:-0.5px;">${moniker}</span></td>
          <td style="padding-left:12px;"><div style="font-size:15px;font-weight:700;color:#1a1a2e;">${portfolioName}</div>
            <div style="font-size:11px;color:#6b6b8a;margin-top:1px;">${tagline}</div></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px 32px;">
        <p style="margin:0 0 20px;font-size:14px;color:#6b6b8a;">Hi ${toName} — your dealing window opens tomorrow. Here's what the rules say to do this month:</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:${accentBg};border-radius:12px;padding:20px;">
          <tr><td>
            <div style="font-size:11px;font-weight:700;color:${primaryColor};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">This month</div>
            <div style="font-size:18px;font-weight:700;color:${severityColor};margin-bottom:8px;">${nextMove.action}</div>
            <div style="font-size:14px;color:#374151;line-height:1.6;margin-bottom:8px;">${nextMove.what}</div>
            <div style="font-size:13px;color:#6b6b8a;font-style:italic;">${nextMove.why}</div>
          </td></tr>
          ${windowRow}
        </table>
        <table cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr>
          <td style="background:${primaryColor};border-radius:10px;">
            <a href="${APP_URL}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Open ${portfolioName}</a>
          </td></tr></table>
      </td></tr>
      <tr><td style="padding:16px 32px;border-top:1px solid ${borderColor};background:${accentBg};">
        <p style="margin:0;font-size:11px;color:#9999b3;">Monthly reminder — sent the day before your dealing window opens. Discipline over prediction.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`.trim(),
  })

  if (error) throw new Error(error.message)
  return { skipped: false as const }
}

// ─── Crash Protocol — Atlas Core ─────────────────────────────────────────
/**
 * Urgent notification when the portfolio triggers the Art. XIV crash protocol.
 * Separate from the daily digest — sent immediately when the threshold is crossed.
 */
export async function sendCrashProtocolEmail(
  toEmail: string,
  toName: string,
  drawdownPct: number,
  sgovPct: number,
) {
  if (!emailConfigured()) return { skipped: true as const, reason: "RESEND_API_KEY not set" }

  const sgovFloor = 8
  const sgovExcess = Math.max(0, sgovPct - sgovFloor)
  const sgovNote = sgovExcess > 0
    ? `SGOV is at ${sgovPct.toFixed(1)}% — ${sgovExcess.toFixed(1)}% above the ${sgovFloor}% floor. Pre-committed response A1: deploy 50% of that excess (≈ ${(sgovExcess / 2).toFixed(1)}% of portfolio) into VWRA first.`
    : `SGOV is at the ${sgovFloor}% floor — no dry powder to deploy.`

  const { error } = await getResend().emails.send({
    from: FROM,
    to: toEmail,
    subject: `Atlas Core — Crash Protocol active (portfolio −${Math.abs(drawdownPct).toFixed(0)}% from ATH)`,
    html: `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#fff1f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;"><tr><td align="center">
    <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;border:2px solid #dc2626;overflow:hidden;">
      <tr><td style="padding:28px 32px 20px;background:#dc2626;">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="background:rgba(255,255,255,0.2);border-radius:12px;width:40px;height:40px;text-align:center;vertical-align:middle;">
            <span style="color:#ffffff;font-size:13px;font-weight:900;letter-spacing:-0.5px;">AC</span></td>
          <td style="padding-left:12px;"><div style="font-size:15px;font-weight:700;color:#ffffff;">Atlas Core</div>
            <div style="font-size:11px;color:#fecaca;margin-top:1px;">Crash Protocol — Art. XIV</div></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px 32px;">
        <div style="font-size:24px;font-weight:800;color:#dc2626;margin-bottom:8px;">Portfolio −${Math.abs(drawdownPct).toFixed(0)}% from ATH</div>
        <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">Hi ${toName}, the Art. XIV Crash Protocol has activated. Your pre-committed responses override any in-the-moment impulse.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff1f2;border-radius:12px;padding:20px;margin-bottom:20px;">
          <tr><td>
            <div style="font-size:11px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">What to do — in order</div>
            <div style="font-size:13px;color:#1f2937;line-height:1.8;">
              1. <strong>SGOV deployment (A1):</strong> ${sgovNote}<br>
              2. <strong>Continue contributions (A2):</strong> Keep making scheduled monthly contributions into VWRA — unchanged.<br>
              3. <strong>Do not sell:</strong> Do not exit any position. Do not redesign the portfolio.<br>
              4. <strong>Log the exception:</strong> Record this event in the governance log.
            </div>
          </td></tr>
        </table>
        <p style="margin:0 0 20px;font-size:13px;color:#6b7280;line-height:1.5;font-style:italic;">The 2022 rule: keep buying during a rate-driven bear market. Markets have always recovered. Selling when things are down locks in a loss permanently.</p>
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="background:#dc2626;border-radius:10px;">
            <a href="${APP_URL}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Open Atlas Core — Log the Exception</a>
          </td></tr></table>
      </td></tr>
      <tr><td style="padding:16px 32px;border-top:1px solid #fecaca;background:#fff1f2;">
        <p style="margin:0;font-size:11px;color:#9ca3af;">Art. XIV · Art. XI · Pre-committed responses A1 and A2. Crash protocol remains active until the drawdown clears −25%.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`.trim(),
  })

  if (error) throw new Error(error.message)
  return { skipped: false as const }
}

// ─── Annual Constitution Audit Reminder ──────────────────────────────────
/** Sent January 1 each year — prompts both users to run their annual review. */
export async function sendAnnualAuditEmail(
  toEmail: string,
  toName: string,
  portfolio: "atlas-core" | "silicon-brick-road",
  constitutionVersion: string,
) {
  if (!emailConfigured()) return { skipped: true as const, reason: "RESEND_API_KEY not set" }

  const isAtlas = portfolio === "atlas-core"
  const primaryColor = isAtlas ? "#7c3aed" : "#0284c7"
  const bgColor = isAtlas ? "#f4f4f8" : "#f0f9ff"
  const borderColor = isAtlas ? "#e2e2ee" : "#bae6fd"
  const moniker = isAtlas ? "AC" : "SBR"
  const portfolioName = isAtlas ? "Atlas Core" : "Silicon Brick Road"

  const atlasChecklist = isAtlas ? `
    <li>Confirm personal SGD emergency liquidity remains outside Atlas.</li>
    <li>Review UCITS threshold status (Art. XV) — if US-sited ETF value is approaching USD 100k, confirm migration timeline.</li>
    <li>Check look-through data freshness — has any factsheet changed materially in the past year?</li>
    <li>Review the governed 5% Bitcoin sleeve and its approved vehicle identity.</li>
    <li>Confirm broker (IBKR Singapore) and custodian risk is acceptable.</li>` : `
    <li>Confirm SBR still has no fixed spending date or mandatory target value.</li>
    <li>Review IMID 80%, EQAC 10%, SMH 5% and IB01 5% against Dami's circumstances.</li>
    <li>If a real SGD use has emerged, document its amount, date and flexibility before changing risk.</li>
    <li>Review hidden-exposure factsheets — are provider holdings files current?</li>`

  const { error } = await getResend().emails.send({
    from: FROM,
    to: toEmail,
    subject: `${portfolioName} — Annual Constitution Audit (${new Date().getFullYear()})`,
    html: `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:${bgColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;"><tr><td align="center">
    <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid ${borderColor};overflow:hidden;">
      <tr><td style="padding:28px 32px 20px;border-bottom:1px solid ${borderColor};">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="background:${primaryColor};border-radius:12px;width:40px;height:40px;text-align:center;vertical-align:middle;">
            <span style="color:#ffffff;font-size:11px;font-weight:900;">${moniker}</span></td>
          <td style="padding-left:12px;"><div style="font-size:15px;font-weight:700;color:#1a1a2e;">${portfolioName}</div>
            <div style="font-size:11px;color:#6b6b8a;">Annual audit · Constitution ${constitutionVersion}</div></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px 32px;">
        <h2 style="margin:0 0 8px;font-size:18px;font-weight:700;color:#1a1a2e;">Happy New Year — annual review due</h2>
        <p style="margin:0 0 20px;font-size:14px;color:#6b6b8a;line-height:1.6;">Hi ${toName}, it's time for the annual constitution audit. This is your most important maintenance task — it prevents the plan from drifting away from reality as your circumstances change.</p>
        <div style="font-size:13px;font-weight:700;color:#1a1a2e;margin-bottom:10px;">Review checklist:</div>
        <ul style="margin:0 0 20px;padding-left:20px;font-size:13px;color:#374151;line-height:1.9;">${atlasChecklist}
          <li>Read through the full constitution document — confirm every rule still represents your intent.</li>
          <li>Update the "last reviewed" date in the app after completing the audit.</li>
        </ul>
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="background:${primaryColor};border-radius:10px;">
            <a href="${APP_URL}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Open ${portfolioName}</a>
          </td></tr></table>
      </td></tr>
      <tr><td style="padding:16px 32px;border-top:1px solid ${borderColor};">
        <p style="margin:0;font-size:11px;color:#9999b3;">Annual audit reminder — sent January 1. The constitution governs; the app implements.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`.trim(),
  })

  if (error) throw new Error(error.message)
  return { skipped: false as const }
}

export async function sendPasswordResetEmail(
  toEmail: string,
  toName: string,
  token: string
) {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`

  const { error } = await getResend().emails.send({
    from: FROM,
    to: toEmail,
    subject: "Reset your Atlas Core password",
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background-color:#f4f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:480px;background:#ffffff;border-radius:16px;border:1px solid #e2e2ee;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 32px 24px;border-bottom:1px solid #e2e2ee;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:linear-gradient(135deg,#8b5cf6,#7c3aed);border-radius:12px;width:40px;height:40px;text-align:center;vertical-align:middle;">
                    <span style="color:#ffffff;font-size:13px;font-weight:900;letter-spacing:-0.5px;">AC</span>
                  </td>
                  <td style="padding-left:12px;">
                    <div style="font-size:15px;font-weight:700;color:#1a1a2e;">Atlas Core</div>
                    <div style="font-size:11px;color:#6b6b8a;margin-top:1px;">v3.1 · Atlas Core</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a2e;">Reset your password</h1>
              <p style="margin:0 0 24px;font-size:14px;color:#6b6b8a;line-height:1.6;">Hi ${toName}, we received a request to reset your Atlas Core password. Click the button below to choose a new password.</p>
              <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#7c3aed;border-radius:10px;">
                    <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Reset Password</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:12px;color:#9999b3;">This link expires in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email.</p>
              <p style="margin:0;font-size:11px;color:#b3b3cc;word-break:break-all;">Or copy this link: ${resetUrl}</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #e2e2ee;background:#f9f9fc;">
              <p style="margin:0;font-size:11px;color:#9999b3;">Atlas Core is a private investment dashboard. This email was sent to ${toEmail}.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim(),
  })

  if (error) throw new Error(error.message)
}
