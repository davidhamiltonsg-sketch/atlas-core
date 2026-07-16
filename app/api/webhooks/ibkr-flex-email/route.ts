import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { parseFlexXml, parseFlexActivity } from "@/lib/ibkr-flex"
import { applyFlexPositionsForUser, importIbkrActivityForUser } from "@/lib/holdings-sync"
import { verifyMailgunSignature } from "@/lib/mailgun-webhook"
import { constitutionForFlexAccountId, extractFlexAccountId, flexEmailShape, looksLikeFlexAttachment } from "@/lib/ibkr-flex-email"
import { portfolioOwner } from "@/lib/active-portfolio"

export const maxDuration = 60
export const dynamic = "force-dynamic"

// IBKR Flex email-delivery ingestion — an alternative to the Flex Web Service
// (SendRequest/GetStatement) polling path, for when that API is unavailable on an
// account (activation delay, busy-window failures, etc.). IBKR emails the same XML on
// its own schedule (Client Portal → Performance & Reports → Flex Queries → Flex Queries
// Delivery); Mailgun receives it at a dedicated address and forwards it here as a
// "store and notify" Route. No SendRequest/GetStatement round trip — the XML has
// already arrived — so this reuses the exact same parse + persistence functions as the
// polling path (parseFlexXml/parseFlexActivity, applyFlexPositionsForUser/
// importIbkrActivityForUser), just triggered by delivery instead of a poll.
//
// Unattended and internet-facing: authenticity rests entirely on the Mailgun HMAC
// signature (verifyMailgunSignature) plus a recipient allowlist. Never trust the email
// body/attachments before that check passes.
export async function POST(req: Request) {
  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY
  if (!signingKey) {
    console.error("[ibkr-flex-email] MAILGUN_WEBHOOK_SIGNING_KEY is not configured")
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 })
  }

  const timestamp = String(form.get("timestamp") ?? "")
  const token = String(form.get("token") ?? "")
  const signature = String(form.get("signature") ?? "")
  if (!verifyMailgunSignature(timestamp, token, signature, signingKey)) {
    console.error("[ibkr-flex-email] signature verification failed")
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  // Defense in depth beyond the signature: only accept mail actually addressed to the
  // dedicated inbound address, in case the Mailgun Route is ever broadened by mistake.
  const expectedRecipient = process.env.IBKR_FLEX_EMAIL_RECIPIENT
  const recipient = String(form.get("recipient") ?? "").trim().toLowerCase()
  if (expectedRecipient && recipient !== expectedRecipient.trim().toLowerCase()) {
    console.warn(`[ibkr-flex-email] unexpected recipient "${recipient}", ignoring`)
    return NextResponse.json({ ok: true, skipped: "recipient mismatch" })
  }

  const attachments: Array<{ name: string; text: string }> = []
  for (const [, value] of form.entries()) {
    if (typeof value === "string") continue
    const file = value as File
    if (!looksLikeFlexAttachment(file.name ?? "", file.type ?? "")) continue
    attachments.push({ name: file.name, text: await file.text() })
  }

  if (attachments.length === 0) {
    return NextResponse.json({ ok: true, skipped: "no XML attachments" })
  }

  const results: Array<{ file: string; accountId: string; portfolio: string; snapshots?: number; trades?: number; dividends?: number; contributions?: number }> = []
  const errors: string[] = []
  let touchedAny = false

  for (const { name, text } of attachments) {
    const accountId = extractFlexAccountId(text)
    const constitutionId = constitutionForFlexAccountId(accountId)
    if (!constitutionId) {
      errors.push(`${name}: account "${accountId}" does not match a configured portfolio — set IBKR_FLEX_ACCOUNT_ID / IBKR_SBR_FLEX_ACCOUNT_ID`)
      continue
    }
    const owner = await portfolioOwner(constitutionId)
    if (!owner) {
      errors.push(`${name}: ${constitutionId} owner is not configured`)
      continue
    }

    const shape = flexEmailShape(text)
    try {
      if (shape.hasPositions) {
        const { positions } = parseFlexXml(text)
        const snapshots = await applyFlexPositionsForUser(owner.id, positions)
        results.push({ file: name, accountId, portfolio: constitutionId, snapshots })
        touchedAny = true
      }
      if (shape.hasActivity) {
        const { executions, dividends, ledger } = parseFlexActivity(text)
        const r = await importIbkrActivityForUser(owner.id, executions, dividends, ledger)
        results.push({ file: name, accountId, portfolio: constitutionId, trades: r.trades, dividends: r.dividends, contributions: r.contributions })
        touchedAny = true
      }
      if (!shape.hasPositions && !shape.hasActivity) {
        errors.push(`${name}: no recognisable OpenPosition/Trade/CashTransaction rows`)
      }
    } catch (e) {
      // A DB error here is worth a Mailgun retry — don't swallow it into the 200 response.
      console.error(`[ibkr-flex-email] failed to persist ${name}:`, e)
      return NextResponse.json({ error: e instanceof Error ? e.message : "persist failed" }, { status: 500 })
    }
  }

  if (touchedAny) {
    for (const p of ["/", "/portfolio", "/ytd", "/contributions", "/trades", "/governance", "/reports", "/forecast", "/holdings", "/risk", "/mission-control"]) {
      revalidatePath(p)
    }
  }

  return NextResponse.json({ ok: true, results, errors: errors.length ? errors : undefined })
}
