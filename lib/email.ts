import { Resend } from "resend"
import type { DigestItem } from "@/lib/governance-digest"

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
  info:   { color: "#4f46e5", bg: "#f5f3ff", label: "Reminder" },
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
          <td style="background:linear-gradient(135deg,#6366f1,#7c3aed);border-radius:12px;width:40px;height:40px;text-align:center;vertical-align:middle;">
            <span style="color:#ffffff;font-size:13px;font-weight:900;letter-spacing:-0.5px;">AC</span></td>
          <td style="padding-left:12px;"><div style="font-size:15px;font-weight:700;color:#1a1a2e;">Atlas Core</div>
            <div style="font-size:11px;color:#6b6b8a;margin-top:1px;">Daily governance check</div></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px 32px;">
        <p style="margin:0 0 16px;font-size:14px;color:#6b6b8a;line-height:1.6;">Hi ${toName}, here's what your rules flagged today:</p>
        <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
        <table cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr>
          <td style="background:#4f46e5;border-radius:10px;">
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
                  <td style="background:linear-gradient(135deg,#6366f1,#7c3aed);border-radius:12px;width:40px;height:40px;text-align:center;vertical-align:middle;">
                    <span style="color:#ffffff;font-size:13px;font-weight:900;letter-spacing:-0.5px;">AC</span>
                  </td>
                  <td style="padding-left:12px;">
                    <div style="font-size:15px;font-weight:700;color:#1a1a2e;">Atlas Core</div>
                    <div style="font-size:11px;color:#6b6b8a;margin-top:1px;">v1.4 · GDEA</div>
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
                  <td style="background:#4f46e5;border-radius:10px;">
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
