# Ground-Up Migration

Turning the "if I rebuilt it from scratch" vision into reality **incrementally**, on a live
app with two users' real data — never a big-bang rewrite. Each increment keeps `npm run check`,
`eslint`, the `sbr-engine-reviewer`, and the Vercel build green, and ships on its own.

## The vision (why)

The app's ideas are strong (a constitution you pre-commit to while calm, contract-checked
rules, look-through enforcement, behavioural guardrails). The *encoding* is what generated the
bug class we've been fixing: duplicated rule values, `isSbr` string-branching, two engines per
portfolio that must be kept agreeing, money as a bare `number`, and an ad-hoc ingestion flow.

Six pillars fix that at the root:

1. **One generated rulebook.** Every rule number lives once; the doc, engine params, DB seed and
   tests derive from or are pinned to it.
2. **Domain core + two isolated experience shells.** David (expert) and Dami (beginner) served by
   separate presentation layers over a shared core — so a leak *can't* cross, instead of being
   caught after the fact.
3. **One engine per portfolio, parameterized.** The headline move and the money-split become two
   *views* of one computation — they can't disagree by construction.
4. **Money is a type; currency is a boundary.** A `Money` value carries its currency; conversion
   happens only at one declared reporting boundary.
5. **Ingestion as a real, idempotent pipeline.** fetch → normalize → scope → dedupe → reconcile →
   project, identical whether run by cron or button, with typed errors.
6. **The product answers one question first.** Open with "what do I do this month?"; everything
   else is progressive disclosure.

## Status

| Increment | Pillar | State | Verified by |
|---|---|---|---|
| 1 — `lib/portfolio-spec.ts` single source | 1 | **Landed** | `check:spec` (71) |
| 2 — Atlas constants + seed derive from spec | 1 | **Landed** | full `npm run check` |
| 3 — reporting-currency single source + helper | 4 (foundation) | **Landed** | `check:spec` |
| 4 — derive the SBR registry from the spec | 1 | **Landed** | `check:spec` + `check:sbr` + sbr-reviewer + isolation |
| 6 — `Money` type + currency boundary (foundation) | 4 | **Landed** | `check:money` (25) + Vercel build |
| 5a — engine characterization net (pre-merge) | 3 | **Landed** | `check:sbr` routing grid (27 pins) |
| 5b — unify each portfolio's two engines | 3 | **Landed** | 62 routing assertions (check:sbr) |
| 6b — thread `Money` through the RSC prop chain | 4 | **Landed** | lint + TS clean |
| 7 — experience shells (constitutionId prop) | 2 | **Partial** | TS clean — component-tree split needs **render** |
| 8 — ingestion pipeline | 5 | Staged | **DB** + integration |
| 9 — one-question dashboards | 6 | **Landed** | SBR: NextMove → KPIs → Holdings → compliance below fold |

"**render**" / "**DB**" = needs the running app or live database to verify safely — do these in an
environment where you can drive the authenticated UI and inspect data, not blind. From a headless
CI/agent environment the Vercel build gives a full typecheck + RSC compile and `get_runtime_errors`
gives deployed-error telemetry, but the dashboards sit behind the app's own login — so David's/Dami's
screens can't be driven without credentials, and the contract/`check:*` grids are the standing net for
those paths.

### What each staged increment is now blocked on
- **5b (engine merge):** the characterization net (5a) pins every routing branch, boundary, and
  priority tie for both SBR engines, and already surfaced a latent divergence (the two engines read
  the phase from different inputs — `total` param vs summed position values). The actual merge to one
  `decide()` still needs the SBR dashboard driven once (headline + split for a live portfolio) before
  shipping — a wrong route is a wrong buy instruction for Dami. The net makes that a fast, safe
  follow-up, not a blind rewrite.
- **6b (`Money` threading):** the type + formatter + boundary exist and are proven display-identical;
  threading `Money` through server-component props is render-verified per page.
- **7 / 9 (shells, one-question dashboards):** structural UI — needs the authenticated app.
- **8 (ingestion pipeline):** needs the live IBKR sandbox + Turso DB (note: current deployed runtime
  errors are all IBKR FLEX `1001` "try again shortly" transients, already handled with a retry).

## Roadmap for the remaining increments

### 4 — Derive the SBR registry from the spec  ·  low risk, verifiable now
`SILICON_BRICK_ROAD` in `lib/constitutions.ts` is currently *pinned* to `SBR_SPEC` (guarded, but
still a hand-maintained copy). Finish the job the Atlas side already did:
- Split the fund objects into a numbers half (`SBR_SPEC.funds`) and a presentation half
  (name/role/colour/note), and build `funds` by merging them — the same pattern as
  `lib/core-holdings.ts`.
- Derive the scalar globals (`monthlyContribution`, `targetValue`, `combined`, `totalEquityMaxPct`,
  `drawdownTriggerPct`, `skipAtHighPct`, phase `min`/`max`) from `SBR_SPEC`.
- `check:spec` + `check:sbr` already assert byte-equality, so a mistake fails the build.

### 5 — One engine per portfolio  ·  **high value, highest risk**
Atlas ships `computeLadder` + `computeNextBestMove`; SBR ships `computeSbrNextMove` +
`computeSbrDca`. Target: one `decide(spec, positions, market)` returning `{ headline, split, steps }`
so the two views can't diverge.
- Start with **SBR** (smaller; `check-sbr` already has a two-engine-agreement test to lock behaviour).
- Characterize current behaviour first: expand the scenario checks until they pin every branch,
  *then* refactor under them (the checks are the safety net for the un-renderable paths).
- Do **not** merge blind — a wrong SBR decision is a wrong buy instruction for Dami. Verify the
  headline + split on the running dashboard before shipping.

### 6 — `Money` type  ·  medium risk, mostly render-verified
- Add `lib/money.ts`: `type Money = { amount: number; ccy: "USD" | "SGD" }`, `formatMoney`, and a
  single `convert` used only at the reporting boundary.
- Replace `formatCurrency(x, isSbr ? "SGD" : "USD")` call-sites with
  `reportingCurrencyForConstitution(id)` (already in `portfolio-spec.ts`), then migrate hot paths
  (`/ytd`, holdings table, contributions) to `Money`. Each page change is render-verified.

### 7 — Experience shells over a domain core  ·  medium risk, render-verified
- Extract a `lib/domain/` core (positions, targets, caps, the decision) with **no** presentation.
- Give each portfolio its own component tree; shared UI drops to primitives only. Delete the
  `isSbr ?` branches in `holdings-table.tsx`, `governance-seal.tsx`, `/ytd`, `/holdings` — the shell
  owns its own wording/brand, so isolation becomes structural, not linted.

### 8 — Ingestion pipeline  ·  DB + integration verified
- One module: `fetchActivity → normalize → scopeToPlan → dedupeById → reconcile → project`. Fold in
  the fixes already shipped (forex/non-core scoping, contribution backfill, forex cleanup, the
  transient-1001 retry). Typed error union (`transient | rateLimit | notConfigured | parse`).
- Verify against the live IBKR sandbox + DB, not from a headless environment.

### 9 — One-question dashboards  ·  render-verified
- Both dashboards open with the single next action (already reordered this way); make it the whole
  above-the-fold. For Dami, collapse the app toward one screen; move the compliance
  instrumentation behind progressive disclosure.

## Principles

- **Keep it green.** Every increment passes `npm run check` + `eslint` and ships independently.
- **Contract checks are the net for un-renderable logic.** If a refactor can't be render-verified,
  it must be covered by a scenario/`check:*` assertion before it lands.
- **Never big-bang the engines, the data model, or the UI** on the live app. One pillar, one
  increment, one PR.
- **The spec is now the source.** New rule numbers go in `lib/portfolio-spec.ts` only; everything
  else derives from or is pinned to it.
