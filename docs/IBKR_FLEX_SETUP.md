# IBKR Flex Query — complete read-only portfolio ledger

The app only reads Flex Web Service reports. It does not use an IBKR trading API and cannot place, modify, or cancel orders.

Create two Flex queries per IBKR account in **Performance & Reports → Flex Queries**.

## 1. Positions query

Include **Open Positions** with these fields:

- Account ID, report date and base currency
- Symbol, description, asset category, currency and conid/ISIN where offered
- Position/quantity
- Mark price
- Position value
- Cost basis money
- FIFO unrealised P&L
- Percent of NAV

Also include **Account Information** or **Equity Summary in Base** where available: net liquidation value, cash, accrued cash, available funds, buying power, excess liquidity and maintenance margin.

Environment variables:

- Atlas: `IBKR_FLEX_TOKEN`, `IBKR_FLEX_QUERY_ID`
- SBR: `IBKR_SBR_FLEX_TOKEN`, `IBKR_SBR_FLEX_QUERY_ID`

## 2. Activity query

Use a report period long enough to cover the complete history needed by the app. Include:

### Trades / executions

- Trade ID, order ID and execution ID
- Symbol, asset category and currency
- Buy/sell, quantity and trade price
- Trade date/time and settlement date
- FX rate to base
- IB commission and commission currency
- Net cash/proceeds
- FIFO realised P&L

### Cash transactions

- Transaction ID, type, description, symbol and currency
- Amount, amount in base and FX rate to base
- Date/time and report date
- Dividends and payment-in-lieu
- Deposits and withdrawals
- Withholding taxes
- Broker, exchange, regulatory and other fees
- Debit/credit interest

### Corporate actions

- Transaction/action ID
- Symbol, action type and description
- Date, quantity, proceeds, currency and FX rate
- Splits, mergers, spin-offs, tender events and return of capital

Environment variables:

- Atlas: `IBKR_FLEX_QUERY_ID_ACTIVITY`
- SBR: `IBKR_SBR_FLEX_QUERY_ID_ACTIVITY`

## Reconciliation rules

- Positions are the authority for current units, price, value, cost basis and unrealised P&L.
- Executions are the authority for buys, sells, commissions and realised P&L.
- Cash deposits and withdrawals are the authority for contributions; purchases are not treated as contributions when cash data is available.
- Dividends remain separate from contributions and performance cash flows.
- Fees, taxes, interest, FX adjustments and corporate actions remain in the immutable IBKR ledger.
- Every activity row is deduplicated by its IBKR external ID. Re-running a report is safe.
- Currency-conversion executions are not treated as investment holdings or contributions.
