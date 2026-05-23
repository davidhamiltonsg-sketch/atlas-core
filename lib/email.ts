import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = process.env.EMAIL_FROM ?? "Atlas Core <onboarding@resend.dev>"
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

export async function sendPasswordResetEmail(
  toEmail: string,
  toName: string,
  token: string
) {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`

  const { error } = await resend.emails.send({
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
                    <div style="font-size:11px;color:#6b6b8a;margin-top:1px;">v5.2 · GDEA</div>
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
