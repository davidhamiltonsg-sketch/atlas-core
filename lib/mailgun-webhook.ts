import crypto from "node:crypto"

// Mailgun signs every inbound webhook with HMAC-SHA256(signingKey, timestamp + token) —
// https://documentation.mailgun.com/en/latest/user_manual.html#webhooks (Securing Webhooks).
// Verifying this is the ONLY thing standing between "an email arrived" and "this webhook
// writes real portfolio data" — anyone who discovers the URL could otherwise inject fake
// positions/trades. Pure and unit-testable; no network or DB access.
export function verifyMailgunSignature(
  timestamp: string,
  token: string,
  signature: string,
  signingKey: string,
  now: number = Date.now(),
): boolean {
  if (!timestamp || !token || !signature || !signingKey) return false
  if (!/^[0-9a-f]+$/i.test(signature)) return false

  // Replay protection — Mailgun signatures don't expire on their own, so an old captured
  // signature would otherwise be valid forever. 5 minutes covers normal delivery latency.
  const tsSeconds = Number(timestamp)
  if (!Number.isFinite(tsSeconds)) return false
  const ageSeconds = Math.abs(now / 1000 - tsSeconds)
  if (ageSeconds > 300) return false

  const expected = crypto.createHmac("sha256", signingKey).update(timestamp + token).digest("hex")
  const a = Buffer.from(expected, "hex")
  const b = Buffer.from(signature, "hex")
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
