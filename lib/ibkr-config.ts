import type { ConstitutionId } from "@/lib/constitutions"

export interface IbkrCredentials {
  token?: string
  positionsQuery?: string
  /** Dedicated Executions+CashTransactions query; undefined ⇒ fall back to positions. */
  activityQuery?: string
}

// Single source of truth for which IBKR Flex credentials a constitution uses.
//
// STRICT SEPARATION — the two portfolios are DIFFERENT IBKR accounts owned by
// different people (SBR: Dami's U-account via IBKR_SBR_FLEX_*; Atlas: David's
// account via the unprefixed IBKR_FLEX_*). There is deliberately NO fallback
// from one account's variables to the other's: an SBR sync with missing SBR
// credentials must fail loudly, never silently read Atlas's account (and vice
// versa) — cross-account contamination corrupts both ledgers.
//
// activityQuery is likewise strict: it must be a dedicated Activity Flex query
// (Trades + Cash Transactions + Dividends). Falling back to the positions query
// used to "succeed" while importing zero trades, zero contributions and zero
// dividends — the ledgers froze while holdings kept moving.
export function ibkrCredentialsFor(constitutionId: ConstitutionId): IbkrCredentials {
  const sbr = constitutionId === "silicon-brick-road"
  return sbr
    ? {
        token:          process.env.IBKR_SBR_FLEX_TOKEN,
        positionsQuery: process.env.IBKR_SBR_FLEX_QUERY_ID,
        activityQuery:  process.env.IBKR_SBR_FLEX_QUERY_ID_ACTIVITY,
      }
    : {
        token:          process.env.IBKR_FLEX_TOKEN,
        positionsQuery: process.env.IBKR_FLEX_QUERY_ID,
        activityQuery:  process.env.IBKR_FLEX_QUERY_ID_ACTIVITY,
      }
}
