// Tickers queried against Finnhub insider endpoint
export const WATCH_TICKERS: string[] = [
  'NVDA', 'TSM', 'AVGO', 'ASML', 'AMAT', 'LRCX', 'KLAC', 'MU', 'QCOM', 'TXN', 'AMD', 'INTC', 'ADI',
  'AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL', 'GOOG', 'TSLA', 'COST', 'NFLX',
  'MSTR', 'COIN', 'IBIT',
  'BABA', 'PDD', 'JD',
]

// Narrower list for congressional trades — congress trades large caps
export const CONGRESS_WATCH_TICKERS: string[] = [
  'NVDA', 'TSM', 'AVGO', 'AMD', 'INTC', 'QCOM', 'MU', 'ASML',
  'AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL', 'TSLA', 'NFLX',
  'MSTR', 'COIN', 'IBIT',
]
