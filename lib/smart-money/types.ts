export type SmartMoneySource = 'congress' | 'insider' | 'influencer'
export type TradeAction = 'buy' | 'sell' | 'option_call' | 'option_put' | 'exchange'

export interface SmartMoneyTrade {
  id:               string
  source:           SmartMoneySource
  actor:            string
  role:             string
  ticker:           string
  action:           TradeAction
  valueEstimate:    string
  valueMin:         number
  valueMax:         number
  tradeDate:        string
  disclosureDate:   string
  daysLag:          number
  atlasOverlap:     boolean
  overlapReason?:   string
  overlapTicker?:   string
  sourceUrl?:       string
  notes?:           string
}

export interface SmartMoneyFeed {
  source:    SmartMoneySource
  trades:    SmartMoneyTrade[]
  fetchedAt: string
  error?:    string
  stale?:    boolean
}

export interface SmartMoneyFilter {
  sources:     SmartMoneySource[]
  actions:     TradeAction[]
  atlasOnly:   boolean
  minValue:    number
  daysBack:    number
  searchQuery: string
}

export const DEFAULT_FILTER: SmartMoneyFilter = {
  sources:     ['congress', 'insider', 'influencer'],
  actions:     ['buy', 'sell', 'option_call', 'option_put', 'exchange'],
  atlasOnly:   false,
  minValue:    0,
  daysBack:    90,
  searchQuery: '',
}

export interface SmartMoneyStats {
  totalTrades:   number
  atlasOverlaps: number
  congressBuys:  number
  congressSells: number
  insiderBuys:   number
  insiderSells:  number
  topActors:     Array<{ name: string; count: number }>
  topTickers:    Array<{ ticker: string; buys: number; sells: number }>
  lastUpdated:   string
}
