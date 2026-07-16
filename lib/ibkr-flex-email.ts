import type { ConstitutionId } from "@/lib/constitutions"

// Pure helpers for the Flex email-delivery webhook. No db/network access, so the routing
// logic can be tested directly (see __tests__/ibkr-flex-email.test.ts).

/** Which portfolio an inbound Flex email's IBKR account belongs to. Data-driven via env
 *  vars — same discipline as ibkrCredentialsFor (lib/ibkr-config.ts): a real account
 *  number never appears in source, and there is no fallback between the two portfolios'
 *  accounts. An unrecognised account ID resolves to null (skip, never guess). */
export function constitutionForFlexAccountId(
  accountId: string,
  env: { atlas?: string; sbr?: string } = {
    atlas: process.env.IBKR_FLEX_ACCOUNT_ID,
    sbr: process.env.IBKR_SBR_FLEX_ACCOUNT_ID,
  },
): ConstitutionId | null {
  const trimmed = accountId.trim()
  if (!trimmed) return null
  if (env.atlas && trimmed === env.atlas.trim()) return "atlas-core"
  if (env.sbr && trimmed === env.sbr.trim()) return "silicon-brick-road"
  return null
}

export function extractFlexAccountId(xml: string): string {
  return xml.match(/accountId="([^"]+)"/)?.[1] ?? ""
}

/** A single Flex Statement email can, depending on how the owner defined the query,
 *  contain open positions, activity (trades/dividends/cash), or both — these are
 *  independent signals, not mutually exclusive report "kinds". A pure positions report
 *  can still carry one incidental CashTransaction row (e.g. an interest sweep); that's
 *  legitimate ledger data and is correctly captured by also running the activity path. */
export function flexEmailShape(xml: string): { hasPositions: boolean; hasActivity: boolean } {
  return {
    hasPositions: xml.includes("<OpenPosition"),
    hasActivity: /<(Trade|Execution|CashTransaction)\s/.test(xml),
  }
}

/** True for a filename/content-type that plausibly holds Flex XML — used to pick which
 *  email attachments are worth reading at all. */
export function looksLikeFlexAttachment(filename: string, contentType: string): boolean {
  return /\.xml$/i.test(filename) || /xml/i.test(contentType)
}
