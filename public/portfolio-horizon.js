const HORIZON = {
  atlas: { label: "2045 retirement horizon", today: 426840, years: 19, monthly: 3000, lump: 20000, growth: 0.085, midyear: "2035", copy: "The destination is a range, not a promise. Atlas is designed to maximise the chance of arriving with sufficient retirement capital while surviving severe drawdowns along the way." },
  sbr: { label: "Flexible medium-term horizon", today: 184620, years: 10, monthly: 2000, lump: 0, growth: 0.08, midyear: "Year 5", copy: "SBR has no forced end date. This ten-year view is a planning lens only; when a real use and date emerge, the required amount moves onto an SGD-matched exit path." },
}
let activeHorizon = "atlas"
const money = value => value >= 1e6 ? `S$${(value / 1e6).toFixed(2)}M` : `S$${Math.round(value / 1000)}K`
function futureValue(start, monthly, annual, rate, years) {
  const monthlyRate = rate / 12
  const months = years * 12
  const grownStart = start * Math.pow(1 + monthlyRate, months)
  const grownMonthly = monthlyRate === 0 ? monthly * months : monthly * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate)
  const grownAnnual = rate === 0 ? annual * years : annual * ((Math.pow(1 + rate, years) - 1) / rate)
  return grownStart + grownMonthly + grownAnnual
}
function renderHorizon(id, preserveInputs = false) {
  activeHorizon = id
  const d = HORIZON[id]
  const monthlyInput = document.getElementById("h-monthly-input")
  const lumpInput = document.getElementById("h-lump-input")
  if (!preserveInputs) { monthlyInput.value = d.monthly; lumpInput.value = d.lump }
  const monthly = Math.max(0, Number(monthlyInput.value) || 0)
  const lump = Math.max(0, Number(lumpInput.value) || 0)
  const base = futureValue(d.today, monthly, lump, d.growth, d.years)
  const low = futureValue(d.today, monthly, lump, Math.max(0.02, d.growth - 0.035), d.years)
  const high = futureValue(d.today, monthly, lump, d.growth + 0.035, d.years)
  const mid = futureValue(d.today, monthly, lump, d.growth, Math.round(d.years / 2))
  document.getElementById("horizon-label").textContent = d.label
  document.getElementById("h-today").textContent = money(d.today)
  document.getElementById("h-low").textContent = money(low)
  document.getElementById("h-base").textContent = money(base)
  document.getElementById("h-high").textContent = money(high)
  document.getElementById("h-mid").textContent = money(mid)
  document.getElementById("h-midyear").textContent = d.midyear
  document.getElementById("h-years").textContent = `${d.years}-year view`
  document.getElementById("h-growth").textContent = `${(d.growth * 100).toFixed(1)}% base`
  document.getElementById("h-copy").textContent = d.copy
  for (const el of ["h-low", "h-base", "h-high"]) {
    const node = document.getElementById(el); node.classList.remove("projection-updated"); void node.offsetWidth; node.classList.add("projection-updated")
  }
}
document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => renderHorizon(button.dataset.view)))
for (const id of ["h-monthly-input", "h-lump-input"]) document.getElementById(id).addEventListener("input", () => renderHorizon(activeHorizon, true))
renderHorizon("atlas")
