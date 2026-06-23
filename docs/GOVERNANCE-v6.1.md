# Atlas Core — Governance Document (v6.1)

*Last updated: 24 June 2026. Macro states and the SGOV/SMH levels below were re-verified
against live market sources on this date; per-position levels for VT/QQQM/VWO are carried
from the prior 23 Jun snapshot and may be stale.*

Atlas Core is a **rules-first investment operating system** for a single long-horizon
portfolio with a **2045 retirement target**. The governing principle is simple:

> **Automated governance, manual execution.** The system decides *what* should happen
> from fixed rules; the human only *executes* trades inside approved dealing windows.
> Discipline beats tinkering.

### What changed in v6.1 — *a loss is not a sell signal*

The previous version told the user to **exit BTC** because it was down ~27% and to fund the
SGOV buffer from the proceeds. **That was wrong and has been reversed.**

- **A held conviction asset is never sold because of an unrealised loss.** Hold/sell is
  forward-looking — *"would I buy at today's price?"* A red number is a sunk cost, not a
  signal. The only trigger to sell a conviction asset is a **broken thesis**.
- **BTC is a held conviction asset** (target 7%, hard cap 8%). It is currently underweight,
  so it is **eligible for contributions** and is **accumulated on weakness toward target** —
  never liquidated to fund anything.
- **The SGOV shock buffer is built from new contributions**, gradually over several months —
  **never** by selling an existing position.

---

## 1. The Portfolio

Five core positions, each with a fixed target weight and an identity (its *job*). A sixth
position — **SGOV** — is being added as the defensive buffer.

| Asset | Name | Target | Identity / Job |
|-------|------|:------:|----------------|
| **VT** | Vanguard Total World Stock ETF | **52%** | Global Core — diversification anchor, behavioural stabiliser |
| **QQQM** | Invesco NASDAQ 100 ETF | **23%** | Digital Economy Engine — primary long-term growth (★ conviction) |
| **SMH** | VanEck Semiconductor ETF | **10%** | AI Infrastructure Tilt — targeted, *not* the foundation (★ conviction) |
| **VWO** | Vanguard FTSE Emerging Markets ETF | **8%** | Geographic Diversifier |
| **BTC** | Grayscale Bitcoin Mini ETF | **7%** | Optionality Overlay (★ conviction) — *meaningful, psychologically unimportant* |
| **SGOV** | iShares 0–3 Month Treasury *(being added)* | **8–10%** | Shock Buffer — dry powder, zero equity correlation |

> **Position note (v6.1).** BTC is currently **underweight** vs its 7% target. The action is
> to **keep it and accumulate on weakness toward target** under the 8% cap — *not* to sell.
> The SGOV buffer is established **from new monthly contributions**, never by liquidating BTC
> or anything else.

---

## 2. Position Caps (§2) — absolute ceilings

A position cap requires a **trim** if breached. Distinct from drift triggers (§3), which only
redirect *new* money.

| Asset | Position Cap | Conviction asset? |
|-------|:-----------:|:-----------------:|
| VT | 60% | — |
| QQQM | 30% | ★ |
| SMH | **12%** *(tightened from 15%)* | ★ |
| VWO | 13% | — |
| BTC | 8% | ★ |

**Conviction rule (§3.5).** Conviction assets (QQQM, SMH, BTC) may run above target weight and
**may not be trimmed** unless their §2 Position Cap is breached, and **may not be sold on a
loss** — only on a broken thesis. Conviction protects compounding; the cap protects against
catastrophe.

---

## 3. Drift Governance (§3.1) — the contribution router

Drift triggers govern **where new contributions go** — they do not, by themselves, force a sale.

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
- **Hard trigger** → halt buys on the breaching position; assess a selective trim at the next dealing window. *(For a conviction asset, a trim applies only to a §2 cap breach — never to a paper loss.)*

BTC has **no lower hard trigger** — being underweight BTC is a soft alert that invites
*accumulation*, never a forced action.

---

## 4. Look-Through Concentration (§4) — the highest law

§4 governs **effective** exposure after looking through every fund to the underlying companies
and sectors. **§4 overrides everything, including conviction.**

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

---

## 5. The Contribution Engine (§5)

**Cadence.** Monthly contribution of **$3,000** (default), plus an **annual lump sum of
$20,000**, with a **5% annual contribution growth rate**. Contribution date: the **15th**.

### 5.4 — The Monthly Decision Engine (run in under five minutes, in order)

1. **Has any hard cap been breached?** → If yes, execute the mandated trim immediately (BTC >8% → trim to target; QQQM >30% → halt + trim; **SMH >12% → trim to 10%**; Nvidia >13% → reduce cluster), then go to step 6.
2. **Is any asset below target?** → If yes, direct **100%** of the contribution to the most underweight asset. Then step 6.
3. **Is any asset above its soft band?** → If yes, pause contributions to it and redirect to underweight positions. Do not trim (unless §4 overrides). Then step 6.
4. **Is any structural-review trigger active?** (§4.4) → If yes, schedule a review within 30 days; keep contributing normally. Then step 6.
5. **Normal deployment** → split at target weights: VT 52% · QQQM 23% · SMH 10% · VWO 8% · BTC 7%. Then step 6.
6. **Market regime: drawdown > 25% from all-time high?** → If yes, activate the Crash Protocol (§6.2). Continue DCA unchanged. No discretionary sales.
7. **Compliance confirmation** → within dealing window, contribution executed, governance log updated, drift + concentration reviewed.
8. **System closure** → close. Do not monitor daily. Reopen only at the next scheduled review.

### 5.x — Market-Aware DCA overlay

On top of §5.4 the router:

- **Skips any position at a 52-week high** (within 3%) even if "healthy" — never buy the top. (VT is exempt; it is the continuous anchor.)
- **Deploys into a confirmed dip** (≥12% off recent high) via the **three-tranche rule**: 30% on the first signal, 40% after three green weekly closes from the trough, 30% once the trend is confirmed.
- **Treats an underweight conviction holding (incl. BTC) as eligible** — accumulate on weakness toward target, under its cap.
- **Never routes new money into an overweight position.**
- **Shows an on-screen note** explaining why the plan adapted in any given month.

---

## 6. Behavioural Guards (§6) — the anti-emotion layer

| Rule | Mandate |
|------|---------|
| **A Loss Is Not a Sell Signal** | Never sell a conviction holding because it shows a loss. The decision is forward-looking. An underweight conviction asset is accumulated on weakness toward target; sell only on a broken thesis. |
| **Market-Timing Ban** | No tactical shifts on headlines, elections, macro predictions, or short-term underperformance. |
| **Panic-Selling Prohibition** | No sells in a drawdown without a **48-hour cooling-off** and a rule-based justification. A >25% fall should *increase* contributions, not trigger exits. |
| **Redesign Moratorium** | No structural change within **90 days** of the last; no redesign more than once every **three years** without a structurally justified reason. *Boredom is not an investment thesis.* |
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

## 7. Minimum-Hold & Tranche Rules (constants)

| Constant | Value |
|----------|:-----:|
| Minimum hold before any sale | **90 days** |
| SMH concentration cap (§4 override) | **12%** |
| Shock-buffer target / floor | **10% / 8%** (built from contributions) |
| Entry tranches (1 / 2 / 3) | **30% / 40% / 30%** |
| "Overbought — do not add" | within **3%** of 52-week high |
| "Dip worth deploying into" | **≥12%** below recent high |
| SMH alert ladder | $590 (watch) · $550 (tranche 1) · $510 (tranche 2) |

---

## 8. Compliance (§7)

- **Manual execution only** — inside approved dealing windows, with employer pre-approval where firm policy requires it.
- **Monthly execution cadence** — confirm dealing window → review allocation vs target → check look-through concentration → generate drift-adjusted plan → execute and log each transaction → update the intelligence log.
- **Emergency-reserve rule** — adequate reserves held **outside** the portfolio at all times. No withdrawals before 2045 except in documented extraordinary circumstances.

---

## 9. Rebalancing Cadence

- **Monthly:** allocation + contribution glance only.
- **Quarterly:** strategic review — drift, overlap, concentration, behavioural audit.
- **Formal rebalance:** annual, in January, unless a hard threshold breaches mid-year.
- **Emergency review trigger:** portfolio falls >25%, or any hard cap is breached.

---

## 10. Precedence — the order of laws

> **§4 Look-Through Concentration → §3 Drift Governance → §5 Contribution Engine → all other sections.**

- **Concentration always overrides conviction.**
- **Hard triggers always override soft alerts.**
- **A paper loss never overrides anything** — it is not an input to any sell decision.

### Next Best Move precedence (the engine's decision ladder)

The dashboard's single "Next Best Move" walks this ladder and returns the first hit:

1. **Hard cap / concentration breach** → TRIM to target
2. **Defensive gap** (buffer < 8%) → BUILD SGOV **from new contributions** (never by selling)
3. **Market opportunity** (confirmed dip) → DEPLOY tranche 1 into the dip
4. **Conviction underweight** (e.g. BTC below target) → ACCUMULATE on weakness toward target (never sell at a loss)
5. **Hard drift underweight** → FILL the biggest gap
6. **Soft drift** → REDIRECT the contribution
7. **Healthy** → STANDARD DCA (skip anything at a 52-week high)

If everything is healthy, the move is *"keep doing your standard DCA."* There is never a
"nothing to do" that leaves the user guessing.

---

## 11. Governance Rule Register

34 rules are stored in the database and enforced, grouped into nine categories: VT Governance (4),
QQQM Governance (4), SMH Governance (2), VWO Governance (1), BTC Governance (2),
Overlap & Concentration §4 (11), Rebalancing (2), Behavioural Guards (5), Compliance (3). The
active count feeds the Behavioural dimension of the Health score.

---

## 12. Market Overlay — verified state (24 Jun 2026)

Only verified figures (no invented numbers); anything unconfirmed is marked UNVERIFIED in-code.

- **SGOV yield** — dividend yield **3.85%** (18 Jun), 30-day SEC yield **3.55%** (17 Jun). *VERIFIED.*
- **SMH** — ~**$668.91**, 52-week range **$265.74–$671.83**; at/near its high → overbought, do not add. *VERIFIED.*
- **Strait of Hormuz / Iran** — **volatile and contested**: a 17 Jun deal to reopen the Strait collapsed; Iran **re-closed it on 20 Jun** (US denies the cited violations); Geneva talks postponed 19 Jun. Brent ~$77–80. **Two-sided, fluid.** *VERIFIED.*
- **Fed** — held **3.50–3.75%** for a 4th consecutive meeting (17 Jun); first meeting under chair Warsh; dropped easing language, nodded to possible hikes → on-hold, hawkish. *VERIFIED.*
- **US–China tariff truce** — expires **10 Nov 2026** (Busan deal); renegotiated annually. *VERIFIED.*

---

*This document reflects the rules as encoded in `lib/constants.ts`, `lib/next-best-move.ts`,
`lib/action-plan.ts`, `lib/health.ts`, the Governance page, and the seeded rule register
(`prisma/seed.ts`). When the code and this document disagree, the code is authoritative.*
