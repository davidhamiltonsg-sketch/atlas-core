// Reproducible planning model, not a forecast. Correlated GBM, monthly steps, fixed weights.
const ASSETS = {
  IMID: { r: .085, v: .18 }, EQAC: { r: .105, v: .24 }, SMH: { r: .115, v: .32 },
  IWQU: { r: .09, v: .16 }, BTC: { r: .12, v: .65 }, DTLA: { r: .045, v: .14 },
  IB01: { r: .035, v: .01 },
}
const RAW_CORR = {
  "IMID|EQAC":.86,"IMID|SMH":.78,"IMID|IWQU":.94,"IMID|BTC":.32,"IMID|DTLA":-.10,"IMID|IB01":0,
  "EQAC|SMH":.82,"EQAC|IWQU":.82,"EQAC|BTC":.36,"EQAC|DTLA":-.12,"EQAC|IB01":0,
  "SMH|IWQU":.72,"SMH|BTC":.35,"SMH|DTLA":-.12,"SMH|IB01":0,
  "IWQU|BTC":.28,"IWQU|DTLA":-.08,"IWQU|IB01":0,
  "BTC|DTLA":0,"BTC|IB01":0,"DTLA|IB01":.10,
}
const CORR = Object.fromEntries(Object.entries(RAW_CORR).map(([k,v]) => [k.split("|").sort().join("|"),v]))
function corr(a,b){ if(a===b)return 1; return CORR[[a,b].sort().join("|")] ?? 0 }
function moments(weights){
  let r=0, variance=0
  for(const [a,w] of Object.entries(weights)) r += w*ASSETS[a].r
  for(const [a,wa] of Object.entries(weights)) for(const [b,wb] of Object.entries(weights))
    variance += wa*wb*ASSETS[a].v*ASSETS[b].v*corr(a,b)
  return { arithmeticReturn:r, volatility:Math.sqrt(variance) }
}
function riskContributions(weights){
  const names=Object.keys(weights), sigma=moments(weights).volatility, out={}
  for(const a of names){
    let marginal=0
    for(const b of names) marginal += weights[b]*ASSETS[a].v*ASSETS[b].v*corr(a,b)
    out[a]=weights[a]*marginal/(sigma*sigma)
  }
  return out
}
let seed=0xA71A531
function uniform(){ seed=(1664525*seed+1013904223)>>>0; return (seed+.5)/4294967296 }
function normal(){ const u=Math.max(uniform(),1e-12),v=uniform(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v) }
function percentile(a,p){ a.sort((x,y)=>x-y); return a[Math.floor((a.length-1)*p)] }
function simulate(name,weights,paths=100000,years=20){
  const {arithmeticReturn,volatility}=moments(weights), dt=1/12, steps=years*12
  const drift=(arithmeticReturn-volatility*volatility/2)*dt, shock=volatility*Math.sqrt(dt)
  const terminal=[], drawdowns=[], annual=[]; let dd30=0,dd40=0,dd50=0,loss=0,cagr10=0,double=0,quad=0
  for(let p=0;p<paths;p++){
    let value=1,peak=1,maxDd=0
    let yearStart=1
    for(let t=0;t<steps;t++){ value*=Math.exp(drift+shock*normal()); peak=Math.max(peak,value); maxDd=Math.min(maxDd,value/peak-1); if((t+1)%12===0){annual.push(value/yearStart-1);yearStart=value} }
    terminal.push(value); drawdowns.push(maxDd)
    if(maxDd<=-.30)dd30++; if(maxDd<=-.40)dd40++; if(maxDd<=-.50)dd50++
    if(value<1)loss++; if(Math.pow(value,1/years)-1>=.10)cagr10++; if(value>=2)double++; if(value>=4)quad++
  }
  const downside=Math.sqrt(annual.filter(x=>x<0).reduce((s,x)=>s+x*x,0)/annual.length)
  return {name,paths,years,seed:"0xA71A531",weights,assumptions:{arithmeticReturn,volatility,riskContributions:riskContributions(weights)},results:{
    medianTerminal:percentile(terminal,.5),p05Terminal:percentile(terminal,.05),p95Terminal:percentile(terminal,.95),
    medianMaxDrawdown:percentile(drawdowns,.5),probabilityMaxDrawdown30:dd30/paths,probabilityMaxDrawdown40:dd40/paths,
    probabilityMaxDrawdown50:dd50/paths,probabilityNominalLoss:loss/paths,probabilityCagrAtLeast10:cagr10/paths,
    probabilityDouble:double/paths,probabilityQuadruple:quad/paths,
    oneYearVaR95:-percentile(annual,.05),oneYearVaR99:-percentile(annual,.01),sortinoVs3_5Pct:(arithmeticReturn-.035)/downside,
  }}
}
const v22=simulate("Atlas v2.2",{IMID:.675,EQAC:.15,SMH:.075,BTC:.05,IB01:.05})
const candidate=simulate("Atlas look-through candidate",{IMID:.52,EQAC:.10,SMH:.04,IWQU:.29,BTC:.05,DTLA:0})
const proposedV4=simulate("Attached v4 proposal",{IMID:.65,EQAC:.10,SMH:.05,IWQU:.10,BTC:.05,DTLA:.05})
console.log(JSON.stringify({model:"Correlated geometric Brownian motion; fixed monthly weights; nominal, pre-tax, pre-fee",v22,candidate,proposedV4},null,2))
