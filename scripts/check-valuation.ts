import { openPositionValuation } from "../lib/valuation"
function ok(name:string,pass:boolean){if(!pass)throw new Error(name);console.log(`  ✓ ${name}`)}
console.log("Valuation precedence and reconciliation\n")
const authoritative=openPositionValuation({value:130,units:10,snapshotCostBasis:100,snapshotUnrealizedPnl:30,reconstructedCostBasis:250,reconstructedAveragePrice:25,reportingFxRate:1})
ok("IBKR cost basis overrides reconstructed trades",authoritative.costBasis===100&&authoritative.unrealizedPnl===30&&authoritative.source==="ibkr")
ok("IBKR values reconcile",authoritative.reconciles)
const bad=openPositionValuation({value:130,units:10,snapshotCostBasis:100,snapshotUnrealizedPnl:20,reportingFxRate:1})
ok("inconsistent headline is detected",!bad.reconciles)
const fallback=openPositionValuation({value:120,units:10,reconstructedCostBasis:100,reconstructedAveragePrice:10,reportingFxRate:1})
ok("reconstruction is fallback only",fallback.source==="reconstructed"&&fallback.unrealizedPnl===20)
const complete=[authoritative,fallback].every(x=>x.unrealizedPnl!==null&&x.reconciles)
ok("portfolio headline requires every open position to reconcile",complete)
ok("partial portfolio basis cannot become apparent profit",![authoritative,openPositionValuation({value:50,units:1,reportingFxRate:1})].every(x=>x.unrealizedPnl!==null&&x.reconciles))
