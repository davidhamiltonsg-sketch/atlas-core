import type { ConstitutionId } from "@/lib/constitutions"

export interface IbkrCredentials {
  token?: string
  positionsQuery?: string
  /** Dedicated Executions+CashTransactions query; undefined ⇒ fall back to positions. */
  activityQuery?: string
}

// Single source of truth for which IBKR Flex credentials a constitution uses.
//
// Silicon Brick Road has its own funded IBKR account, so it uses the IBKR_SBR_*
// tokens when they are set and falls back to the main tokens if the SBR account
// isn't wired up yet. Atlas Core always uses the main tokens. Before this, the
// manual refresh (app/portfolio/actions.ts) picked per-constitution but the modal
// "Sync IBKR" route did not — so an SBR user's sync silently hit the Atlas
// account, or 503'd when only the SBR tokens were configured.
export function ibkrCredentialsFor(constitutionId: ConstitutionId): IbkrCredentials {
  const sbr = constitutionId === "silicon-brick-road"
  const pick = (sbrVar: string | undefined, mainVar: string | undefined) =>
    (sbr ? (sbrVar || mainVar) : mainVar)
  return {
    token:          pick(process.env.IBKR_SBR_FLEX_TOKEN,             process.env.IBKR_FLEX_TOKEN),
    positionsQuery: pick(process.env.IBKR_SBR_FLEX_QUERY_ID,          process.env.IBKR_FLEX_QUERY_ID),
    activityQuery:  pick(process.env.IBKR_SBR_FLEX_QUERY_ID_ACTIVITY, process.env.IBKR_FLEX_QUERY_ID_ACTIVITY),
  }
}
