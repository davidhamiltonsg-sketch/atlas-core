import { createClient } from "@libsql/client"
const client = createClient({ url: process.env.DATABASE_URL, authToken: process.env.DATABASE_AUTH_TOKEN })
const users = await client.execute("SELECT id, email, name, role FROM User")
for (const u of users.rows) {
  const hs = await client.execute({ sql: "SELECT ticker FROM Holding WHERE userId = ? ORDER BY ticker", args: [u.id] })
  const tr = await client.execute({ sql: "SELECT COUNT(*) n FROM Trade WHERE userId = ?", args: [u.id] })
  // count snapshots across this user's holdings to find the active account
  let snapTotal = 0
  for (const h of (await client.execute({ sql: "SELECT id FROM Holding WHERE userId = ?", args: [u.id] })).rows) {
    snapTotal += Number((await client.execute({ sql: "SELECT COUNT(*) n FROM Snapshot WHERE holdingId=?", args: [h.id] })).rows[0].n)
  }
  console.log(`USER ${u.email} (${u.role}) id=${String(u.id).slice(0,8)} | trades=${tr.rows[0].n} snaps=${snapTotal} | holdings: ${hs.rows.map(r=>r.ticker).join(", ")}`)
}
