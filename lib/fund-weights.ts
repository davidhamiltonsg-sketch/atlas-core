// ─────────────────────────────────────────────────────────────────────────────
// Canonical fund-level weight tables — the SINGLE source of truth for what each
// governed ETF is made of underneath. Both lib/look-through.ts (Atlas) and
// lib/sbr-look-through.ts (SBR) read from here instead of hand-copying their own
// tables. That hand-copying is exactly how the two engines silently drifted apart
// before this file existed: Atlas had VWRA's technology-sector weight at 37%, SBR
// had it at 27% — both dated as "refreshed 2026-07-16 from fact sheets," but
// nobody had reconciled them. The real figure, from Vanguard's own fund
// documentation, is 35.10%; both engines now derive from that one number.
//
// GOVERNED FUNDS ONLY (plus the EQQQ/SEMI legacy exchange-line aliases of
// EQAC/SMH). A ticker missing from a table below is unclassified for that
// dimension — each engine's own aggregation makes that an explicit warning, not a
// silent zero. Baselines refreshed 2026-07-16 from: Vanguard VWRA fact sheet
// (technology sector 35.10%, confirmed against Vanguard's own fund documentation
// 2026-07-19), Invesco EQQQ holdings (Q2 2026), VanEck SMH holdings (July 2026).
// The daily cron's Yahoo refresh (lib/look-through-refresh.ts) supersedes these at
// runtime for the equity funds.
export const FUND_WEIGHTS_AS_OF = "2026-07-19"

// Approximate % of each ETF made up by each mega-cap (fund fact-sheet level).
export const FUND_COMPANY_WEIGHTS: Record<string, Record<string, number>> = {
  VWRA: { Nvidia: 4.7, Microsoft: 3.2, Apple: 4.3, Amazon: 2.5, Meta: 1.5, Alphabet: 2.1, Broadcom: 1.5, TSMC: 1.2 },
  EQAC: { Nvidia: 8.6, Microsoft: 5.4, Apple: 7.4, Amazon: 5.0, Meta: 3.4, Alphabet: 4.8, Broadcom: 4.6, TSMC: 0.0 },
  EQQQ: { Nvidia: 8.6, Microsoft: 5.4, Apple: 7.4, Amazon: 5.0, Meta: 3.4, Alphabet: 4.8, Broadcom: 4.6, TSMC: 0.0 },
  SMH:  { Nvidia: 19.0, Microsoft: 0.0, Apple: 0.0, Amazon: 0.0, Meta: 0.0, Alphabet: 0.0, Broadcom: 5.6, TSMC: 9.4, ASML: 7.0, AMD: 5.6 },
  SEMI: { Nvidia: 19.0, Microsoft: 0.0, Apple: 0.0, Amazon: 0.0, Meta: 0.0, Alphabet: 0.0, Broadcom: 5.6, TSMC: 9.4, ASML: 7.0, AMD: 5.6 },
  BTC:  {},
  DBMFE: {},
  IBIT: {},
}

// Approximate sector / geography make-up of each ETF (% of the ETF). "digital" is
// the governed "information technology" sector figure (Article IV); ai is a
// broader AI-infrastructure lens that overlaps with digital and semiconductor.
export const FUND_SECTOR_WEIGHTS: Record<string, { semiconductor: number; digital: number; us: number; ai: number }> = {
  VWRA: { semiconductor: 10,  digital: 35.1, us: 63,  ai: 18 },
  EQAC: { semiconductor: 32,  digital: 62,   us: 97,  ai: 35 },
  EQQQ: { semiconductor: 32,  digital: 62,   us: 97,  ai: 35 },
  SMH:  { semiconductor: 100, digital: 90,   us: 66,  ai: 70 },
  SEMI: { semiconductor: 100, digital: 90,   us: 66,  ai: 70 },
  BTC:  { semiconductor: 0,   digital: 0,    us: 0,   ai: 0 },
  DBMFE:{ semiconductor: 0,   digital: 0,    us: 0,   ai: 0 },
  IBIT: { semiconductor: 0,   digital: 0,    us: 0,   ai: 0 },
}

// Geographic make-up of each ETF (% of the ETF): US / Intl-Developed / Emerging / Crypto.
export const FUND_GEO_WEIGHTS: Record<string, { us: number; intlDev: number; emerging: number; crypto: number }> = {
  VWRA: { us: 63,  intlDev: 28, emerging: 9,   crypto: 0 },
  EQAC: { us: 97,  intlDev: 3,  emerging: 0,   crypto: 0 },
  EQQQ: { us: 97,  intlDev: 3,  emerging: 0,   crypto: 0 },
  SMH:  { us: 66,  intlDev: 20, emerging: 14,  crypto: 0 },
  SEMI: { us: 66,  intlDev: 20, emerging: 14,  crypto: 0 },
  BTC:  { us: 0,   intlDev: 0,  emerging: 0,   crypto: 100 },
  DBMFE:{ us: 0,   intlDev: 0,  emerging: 0,   crypto: 0 },
  IBIT: { us: 0,   intlDev: 0,  emerging: 0,   crypto: 100 },
}
