Show the current state of the live Turso database without modifying anything. Read-only.

## What to report

1. **Users** — how many users exist, their names/emails, roles
2. **Holdings per user** — which tickers each user holds, with current target percentages
3. **Latest snapshots** — most recent snapshot date per user, and whether any snapshots exist at all
4. **Governance rules** — total count, how many active vs inactive
5. **Behaviour logs** — count per user

## How to do it

Write a temporary read-only script to the scratchpad directory and run it with `npx tsx`.

The script should use the same Prisma setup as the rest of the codebase:

```typescript
import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import { createClient } from "@libsql/client"
import * as dotenv from "dotenv"

dotenv.config()

const client = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DATABASE_AUTH_TOKEN,
})
const adapter = new PrismaLibSql(client)
const db = new PrismaClient({ adapter })

async function main() {
  const users = await db.user.findMany({
    include: {
      holdings: {
        include: { snapshots: { orderBy: { date: "desc" }, take: 1 } }
      }
    }
  })

  for (const user of users) {
    console.log(`\n=== ${user.name} (${user.email}) [${user.role}] ===`)
    for (const h of user.holdings) {
      const snap = h.snapshots[0]
      const snapStr = snap
        ? `${snap.units} units @ $${snap.price} = $${snap.value?.toFixed(2)} (${snap.date.toISOString().slice(0,10)})`
        : "no snapshot"
      console.log(`  ${h.ticker.padEnd(6)} target=${h.targetPct}%  ${snapStr}`)
    }
  }

  const rules = await db.governanceRule.findMany()
  const active = rules.filter(r => r.active).length
  console.log(`\nGovernance rules: ${rules.length} total, ${active} active, ${rules.length - active} inactive`)

  const logs = await db.behaviourLog.groupBy({ by: ["userId"], _count: true })
  console.log(`Behaviour logs: ${logs.map(l => `${l.userId.slice(0,8)}: ${l._count}`).join(", ")}`)
}

main().catch(console.error).finally(() => db.$disconnect())
```

Write this to the scratchpad, run it, display the output clearly.

## Important

- Never modify any data
- If DATABASE_URL or DATABASE_AUTH_TOKEN are missing from .env, say so and stop
- The .env file is at the project root
