# Atlas Core — Governance Document (v6.0)

*Last updated: 23 June 2026. Market overlay fact-checked against live IBKR data on the same date.*

Atlas Core is a **rules-first investment operating system** for a single long-horizon
portfolio with a **2045 retirement target**. The governing principle is simple:

> **Automated governance, manual execution.** The system decides *what* should happen
> from fixed rules; the human only *executes* trades inside approved dealing windows.
> Discipline beats tinkering.

This document is the constitution. Everything the app surfaces — the dashboard Next Best
Move, the monthly contribution plan, the Command Centre, the health score — is derived
from the rules below.

---

## 1. The Portfolio

Five core positions, each with a fixed target weight and an identity (its *job* in the
portfolio). A sixth position — **SGOV** — is being added in v6.0 as the defensive buffer.

| Asset | Name | Target | Identity / Job |
|-------|------|:------:|----------------|
| **VT** | Vanguard Total World Stock ETF | **52%** | Global Core — diversification anchor, behavioural stabiliser |
| **QQQM** | Invesco NASDAQ 100 ETF | **23%** | Digital Economy Engine — primary long-term growth |
| **SMH** | VanEck Semiconductor ETF | **10%** | AI Infrastructure Tilt — targeted, *not* the foundation |
| **VWO** | Vanguard FTSE Emerging Markets ETF | **8%** | Geographic Diversifier |
| **BTC** | Grayscale Bitcoin Mini ETF | **7%** | Optionality Overlay — *financially meaningful, psychologically unimportant* |
| **SGOV** | iShares 0–3 Month Treasury *(v6.0, new)* | **8–10%** | Shock Buffer — dry powder, zero equity correlation |

> **v6.0 position note.** The Next Best Move engine currently recommends **exiting BTC**
> (structural loser: down ~27%, no income, no diversification benefit) and **recycling the
> proceeds into SGOV** to establish the shock buffer the portfolio has never had.

---

## 2. Position Caps (§2) — absolute ceilings

A position cap is a hard ceiling that **requires a trim** if breached. Distinct from drift
triggers (§3), which only redirect *new* money.

| Asset | Position Cap | Conviction asset? |
|-------|:-----------:|:-----------------:|
| VT | 60% | — |
| QQQM | 30% | ★ |
| SMH | **12%** *(tightened from 15% in v6.0)* | ★ |
| VWO | 13% | — |
| BTC | 8% | — |

**Conviction rule (§3.5).** Conviction assets (QQQM, SMH) may run above target weight and
**may not be trimmed** unless their §2 Position Cap is breached. Conviction protects
compounding; the cap protects against catastrophe.

---

## 3. Drift Governance (§3.1) — the contribution router

Each position has three zones. Drift triggers govern **where new contributions go** — they
do not, by themselves, force selling.

| Asset | Target | Healthy range | Soft trigger | Hard trigger |
|-------|:------:|:-------------:|:------------:|:------------:|
| VT | 52% | 46–58% | <46% or >58% | <42% or >62% |
| QQQM | 23% | 18–28% | <18% or >28% | <15% or >31% |
| SMH | 10% | 7–12% | <7% or >12% | <5% or **>12%** |
| VWO | 8% | 5–11% | <5% or >11% | <3% or >13% |
| BTC | 7% | 6–8% | <6% | **>8%** |

**Response protocol:**

- **Healthy** → no action; continue the monthly schedule unchanged.
- **Soft trigger** → redirect new capital to underweight positions for 2–3 months. *No selling.*
- **Hard trigger** → halt buys on the breaching position; assess a selective trim at the next dealing window.

BTC has **no lower hard trigger** — being underweight BTC is a soft alert only (you are never
*forced* to buy more BTC).

---

## 4. Look-Through Concentration (§4) — the highest law

The single most important section. ETFs overlap: VT, QQQM and SMH all hold Nvidia, Microsoft,
etc. §4 governs **effective** exposure after looking through every fund to the underlying
companies and sectors. **§4 overrides everything, including conviction.**

**Sector / cluster caps**

| Exposure | Soft cap | Hard cap |
|----------|:--------:|:--------:|
| Semiconductor | 16% | 20% |
| Digital Economy (combined) | 48% | 54% |
| US Market (total effective) | 70% | 78% |
| AI Infrastructure cluster | 38% | 46% |

**Single-company caps (effective look-through)**

| Company | Soft cap | Hard cap |
|---------|:--------:|:--------:|
| Nvidia | 10% | 13% |
| Microsoft | 10% | 13% |
| Apple | 8% | 11% |
| Amazon | 7% | 9% |
| Meta / Alphabet (each) | 6% | 8% |
| Broadcom / TSMC (each) | 5% | 7% |

**Redundant-ETF prevention (permanent).** VGT, FTEC, XLK, SOXX, IGV and similar overlapping
technology ETFs are **permanently excluded** — they add concentration without diversification.
This boundary is not subject to review.

---

## 5. The Contribution Engine (§5)

**Cadence.** Monthly contribution of **$3,000** (default), plus an **annual lump sum of
$20,000**, with a **5% annual contribution growth rate**. Contribution date: the **15th**.

### 5.4 — The Monthly Decision Engine (run in under five minutes, in order)

1. **Has any hard cap been breached?** → If yes, execute the mandated trim immediately, then go to step 6.
2. **Is any asset below target?** → If yes, direct **100%** of the contribution to the most underweight asset. No splitting. Then step 6.
3. **Is any asset above its soft band?** → If yes, pause contributions to it and redirect to underweight positions. Do not trim (unless §4 overrides). Then step 6.
4. **Is any structural-review trigger active?** (§4.4) → If yes, schedule a formal review within 30 days; keep contributing normally. Then step 6.
5. **Normal deployment** → split at target weights: VT 52% · QQQM 23% · SMH 10% · VWO 8% · BTC 7%. Then step 6.
6. **Market regime: drawdown > 25% from all-time high?** → If yes, activate the Crash Protocol (§6.2). Continue DCA unchanged. No discretionary sales.
7. **Compliance confirmation** → pre-clearance obtained, within dealing window, contribution executed, governance log updated, drift + concentration reviewed.
8. **System closure** → close. Do not monitor daily. Reopen only at the next scheduled review.

### 5.x — v6.0 Market-Aware DCA overlay

The router is no longer drift-only. On top of §5.4 it now:

- **Skips any position at a 52-week high** (within 3%) even if it is "healthy" — never buy the top. (VT is exempt; it is the anchor.)
- **Deploys into a confirmed dip** via the **three-tranche rule**: 30% on the first signal, 40% after three green weekly closes from the trough, 30% once the trend is confirmed.
- **Never feeds an exit candidate** (e.g. BTC).
- **Redirects skipped money** to the lowest-volatility core (VT) or to a live dip.

---

## 6. Behavioural Guards (§6) — the anti-emotion layer

| Rule | Mandate |
|------|---------|
| **Market-Timing Ban** | No tactical shifts on headlines, elections, macro predictions, or short-term underperformance. Permanently prohibited. |
| **Panic-Selling Prohibition** | No sells in a drawdown without a **48-hour cooling-off period** and a rule-based justification. A >25% fall should *increase* contributions, not trigger exits. |
| **Redesign Moratorium** | No structural change within **90 days** of the last one. The portfolio may not be redesigned more than once every **three years** without a structurally justified reason. *Boredom is not an investment thesis.* |
| **Approved Reasons for Change** | Allowed: major life change, retirement-horizon change, liquidity need, risk-tolerance change, income change >15%. Not allowed: headlines, elections, boredom, social media, temporary underperformance, optimisation addiction. |

### 6.2 — Market Crash Protocol

| Drawdown from ATH | Mandated behaviour |
|-------------------|--------------------|
| > 10% | Normal. Continue contributions. |
| > 15% | Discourage changes. Reinforce the thesis. |
| > 25% | Maintain schedule. Check monthly only. |
| > 40% | Do not open the portfolio more than monthly. **Do not sell.** |

> *Large declines feel permanent while they are happening. Historically they have not been.*

---

## 7. The Minimum-Hold & Tranche Rules (v6.0 constants)

| Constant | Value |
|----------|:-----:|
| Minimum hold before any sale | **90 days** |
| SMH concentration cap (§4 override) | **12%** |
| Shock-buffer target / floor | **10% / 8%** |
| Entry tranches (1 / 2 / 3) | **30% / 40% / 30%** |
| "Overbought — do not add" | within **3%** of 52-week high |
| "Dip worth deploying into" | **≥12%** below recent high |
| SMH alert ladder | $590 (watch) · $550 (tranche 1) · $510 (tranche 2) |

---

## 8. Compliance (§7)

- **Manual execution only** — all trades executed manually inside approved dealing windows, with employer pre-approval where firm policy requires it.
- **Monthly execution cadence** — confirm dealing window → review allocation vs target → check look-through concentration → generate drift-adjusted plan → execute and log each transaction (date, asset, amount, price) → update the intelligence log.
- **Emergency-reserve rule** — adequate emergency reserves are held **outside** the portfolio at all times. The portfolio is never the emergency fund. No withdrawals before 2045 except in documented extraordinary circumstances.

---

## 9. Rebalancing Cadence

- **Monthly:** allocation + contribution glance only.
- **Quarterly:** strategic review — drift, overlap, concentration, behavioural audit.
- **Formal rebalance:** annual, in January, unless a hard threshold breaches mid-year.
- **Emergency review trigger:** portfolio falls >25%, or any hard cap is breached.

---

## 10. Precedence — the order of laws

When two rules conflict, the higher one wins. This order is absolute:

> **§4 Look-Through Concentration → §3 Drift Governance → §5 Contribution Engine → all other sections.**

- **Concentration always overrides conviction.**
- **Hard triggers always override soft alerts.**

### v6.0 Next Best Move precedence (the engine's decision ladder)

The dashboard's single "Next Best Move" is computed by walking this ladder and returning the
first hit:

1. **Hard cap / concentration breach** → TRIM
2. **Defensive gap** (buffer < 8%) → BUILD BUFFER (SGOV)
3. **Structural loser** (a position bleeding with no thesis) → EXIT (BTC)
4. **Market opportunity** (confirmed dip in a quality asset) → DEPLOY TO DIP
5. **Hard drift underweight** → FILL the biggest gap
6. **Soft drift** → REDIRECT contributions
7. **Healthy** → STANDARD DCA (and skip anything at its highs)

There is no "nothing to do" that leaves the user guessing — if everything is healthy, the
move is *"keep doing your standard DCA."*

---

## 11. Governance Rule Register

34 rules are stored in the database and enforced by the engine, grouped into nine categories:

| Category | Rules |
|----------|:-----:|
| VT Governance | 4 |
| QQQM Governance | 4 |
| SMH Governance | 2 |
| VWO Governance | 1 |
| BTC Governance | 2 |
| Overlap & Concentration (§4) | 11 |
| Rebalancing | 2 |
| Behavioural Guards | 5 |
| Compliance | 3 |
| **Total** | **34** |

The live count of *active* rules feeds directly into the portfolio Health score (Behavioural
dimension). Deactivating a rule visibly lowers the score.

---

## 12. Market Overlay — fact-checked state (23 Jun 2026)

The market-aware layer carries only verified figures (no invented numbers):

- **SGOV yield ≈ 3.85%** (dividend yield 18 Jun 2026; 30-day SEC yield 3.53%). *Corrected from a prior 4.8% mis-statement.*
- **Iran / Strait of Hormuz:** de-escalating but volatile — Brent ~$78, framework deal near; risk is now **two-sided**.
- **US–China tariff truce:** extended to **10 Nov 2026**.
- **Fed:** on hold at **3.50–3.75%**, hawkish-risk (June dot plot split; ~30% hike risk by Q1 2027).
- **SMH:** at/near 52-week high (~$664 vs $663.80 high) — overbought; do not add.

---

*This document reflects the rules as encoded in `lib/constants.ts`, `lib/next-best-move.ts`,
`lib/action-plan.ts`, `lib/health.ts`, the Governance page, and the seeded rule register
(`prisma/seed.ts`). When the code and this document disagree, the code is authoritative —
update this document to match.*
