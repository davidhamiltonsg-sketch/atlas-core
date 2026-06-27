import { createClient } from "@libsql/client"
const client = createClient({ url: process.env.DATABASE_URL, authToken: process.env.DATABASE_AUTH_TOKEN })
const h = await client.execute("SELECT id, ticker, name, color, createdAt FROM Holding ORDER BY ticker, createdAt")
console.log("Total holdings:", h.rows.length)
for (const row of h.rows) {
  const c = await client.execute({ sql: "SELECT COUNT(*) as n, MIN(date) as mn, MAX(date) as mx FROM Snapshot WHERE holdingId = ?", args: [row.id] })
  const s = c.rows[0]
  console.log(`${String(row.ticker).padEnd(6)} id=${String(row.id).slice(0,8)} created=${String(row.createdAt).slice(0,10)} snaps=${s.n} range=${String(s.mn).slice(0,10)}..${String(s.mx).slice(0,10)}`)
}
console.log("\nUSER count:", (await client.execute("SELECT COUNT(*) n FROM User")).rows[0].n)
console.log("TRADES:", (await client.execute("SELECT COUNT(*) n FROM Trade")).rows[0].n)
