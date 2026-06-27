import { createClient } from "@libsql/client"
const client = createClient({ url: process.env.DATABASE_URL, authToken: process.env.DATABASE_AUTH_TOKEN })
const holdings = await client.execute("SELECT id, ticker, name, targetPct FROM Holding ORDER BY ticker")
console.log("HOLDINGS:", holdings.rows.length)
for (const h of holdings.rows) {
  const snap = await client.execute({ sql: "SELECT units, price, value, date FROM Snapshot WHERE holdingId = ? ORDER BY date DESC LIMIT 1", args: [h.id] })
  const s = snap.rows[0]
  console.log(`  ${String(h.ticker).padEnd(6)} target=${h.targetPct}%  ${s ? `units=${s.units} price=${s.price} value=${s.value} @${String(s.date).slice(0,10)}` : "NO SNAPSHOT"}`)
}
