import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { Resend } from "resend"
import { parseFlexXml, parseFlexActivity } from "@/lib/ibkr-flex"
import { applyFlexPositionsForUser, importIbkrActivityForUser } from "@/lib/holdings-sync"
import { constitutionForFlexAccountId, extractFlexAccountId, flexEmailShape, looksLikeFlexAttachment } from "@/lib/ibkr-flex-email"
import { portfolioOwner } from "@/lib/active-portfolio"

export const maxDuration = 60
export const dynamic = "force-dynamic"

// IBKR Flex email-delivery ingestion — an alternative to the Flex Web Service
// (SendRequest/GetStatement) polling path, for when that API is unavailable on an
// account (activation delay, busy-window failures, etc.). IBKR emails the same XML on
// its own schedule (Client Portal → Performance & Reports → Flex Queries → Flex Queries
// Delivery) to a dedicated dlh20.com address; Resend Inbound receives it and POSTs an
// "email.received" webhook here.
//
// The webhook payload carries only attachment METADATA (id/filename/content-type) —
// not the XML bytes — so for each attachment this handler makes a follow-up call to
// the Resend Attachments API for a short-lived signed download_url, then fetches that.
// Once downloaded, this reuses the exact same parse + persistence functions as the
// polling path (parseFlexXml/parseFlexActivity, applyFlexPositionsForUser/
// importIbkrActivityForUser) — delivery just triggers it instead of a poll.
//
// Unattended and internet-facing: authenticity rests entirely on the Resend/Svix
// webhook signature (resend.webhooks.verify) plus a recipient allowlist. Never trust
// the event body/attachments before that check passes.
export async function POST(req: Request) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET
  const apiKey = process.env.RESEND_API_KEY
  if (!webhookSecret || !apiKey) {
    console.error("[ibkr-flex-email] RESEND_WEBHOOK_SECRET / RESEND_API_KEY is not configured")
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 })
  }

  const svixId = req.headers.get("svix-id")
  const svixTimestamp = req.headers.get("svix-timestamp")
  const svixSignature = req.headers.get("svix-signature")
  // The signature covers the exact bytes Resend sent — read as raw text, never
  // req.json(), or a re-serialized body will fail verification.
  const payload = await req.text()

  const resend = new Resend(apiKey)
  let event: ReturnType<Resend["webhooks"]["verify"]>
  try {
    if (!svixId || !svixTimestamp || !svixSignature) throw new Error("missing svix-* headers")
    event = resend.webhooks.verify({
      payload,
      headers: { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
      webhookSecret,
    })
  } catch (e) {
    console.error("[ibkr-flex-email] signature verification failed:", e)
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  if (event.type !== "email.received") {
    return NextResponse.json({ ok: true, skipped: `ignored event type "${event.type}"` })
  }

  const { email_id: emailId, to, attachments } = event.data

  // Defense in depth beyond the signature: only accept mail actually addressed to the
  // dedicated inbound address, in case the Resend Route is ever broadened by mistake.
  const expectedRecipient = process.env.IBKR_FLEX_EMAIL_RECIPIENT?.trim().toLowerCase()
  const recipients = to.map((r) => r.trim().toLowerCase())
  if (expectedRecipient && !recipients.includes(expectedRecipient)) {
    console.warn(`[ibkr-flex-email] unexpected recipients ${JSON.stringify(recipients)}, ignoring`)
    return NextResponse.json({ ok: true, skipped: "recipient mismatch" })
  }

  const xmlAttachments = attachments.filter((a) => looksLikeFlexAttachment(a.filename ?? "", a.content_type))
  if (xmlAttachments.length === 0) {
    return NextResponse.json({ ok: true, skipped: "no XML attachments" })
  }

  const files: Array<{ name: string; text: string }> = []
  for (const a of xmlAttachments) {
    const { data, error } = await resend.emails.receiving.attachments.get({ emailId, id: a.id })
    if (error || !data) {
      console.error(`[ibkr-flex-email] failed to fetch attachment metadata ${a.id}:`, error)
      continue
    }
    const res = await fetch(data.download_url)
    if (!res.ok) {
      console.error(`[ibkr-flex-email] failed to download attachment ${a.id}: HTTP ${res.status}`)
      continue
    }
    files.push({ name: a.filename ?? a.id, text: await res.text() })
  }

  if (files.length === 0) {
    return NextResponse.json({ ok: true, skipped: "no XML attachments could be downloaded" })
  }

  const results: Array<{ file: string; accountId: string; portfolio: string; snapshots?: number; trades?: number; dividends?: number; contributions?: number }> = []
  const errors: string[] = []
  let touchedAny = false

  for (const { name, text } of files) {
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
      // A DB error here is worth a Resend retry — don't swallow it into the 200 response.
      console.error(`[ibkr-flex-email] failed to persist ${name}:`, e)
      return NextResponse.json({ error: e instanceof Error ? e.message : "persist failed" }, { status: 500 })
    }
  }

  if (touchedAny) {
    for (const p of ["/", "/portfolio", "/ytd", "/contributions", "/next", "/trades", "/governance", "/compliance", "/reports", "/forecast", "/holdings", "/risk", "/mission-control"]) {
      revalidatePath(p)
    }
  }

  return NextResponse.json({ ok: true, results, errors: errors.length ? errors : undefined })
}
