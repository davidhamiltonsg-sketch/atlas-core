/**
 * Portfolio snapshot update — June 2026
 * Updates snapshot data to IBKR figures as of 2026-06-01.
 * Also inserts synthetic aggregate BUY trades for any position without existing trade records.
 *
 * Run with: npx tsx prisma/update-snapshot-jun01.ts
 */
import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import "dotenv/config"

const url = process.env.DATABASE_URL
const authToken = process.env.DATABASE_AUTH_TOKEN || undefined
if (!url) throw new Error("DATABASE_URL is not set")
const adapter = new PrismaLibSql({ url, authToken })
const prisma = new PrismaClient({ adapter })

const FX = 1.278 // USDSGD at time of snapshot
const SNAPSHOT_DATE = new Date("2026-06-01T08:00:00.000Z")

// IBKR data as of 2026-06-01
const POSITIONS: Record<string, {
  units: number
  price: number   // USD per unit (IBKR mark price)
  value: number   // SGD (units × price × FX)
  costSgd: number // total cost basis in SGD (from IBKR avg cost × units × FX)
}> = {
  VWRA: { units: 428, price: 158.66, value: 86778, costSgd: 73999 },
  EQQQ: { units: 69,  price: 305.84, value: 26968, costSgd: 22862 },
  SEMI: { units: 24,  price: 605.45, value: 18569, costSgd: 8958  },
  VFEA: { units: 129, price: 60.25,  value: 9932,  costSgd: 9708  },
  BTC:  { units: 154, price: 32.48,  value: 6392,  costSgd: 7671  },
}

async function main() {
  console.log("Atlas Core — snapshot update 2026-06-01\n")

  // Find all users with holdings
  const users = await prisma.user.findMany({
    include: { holdings: true },
  })

  for (const user of users) {
    console.log(`User: ${user.email}`)

    for (const holding of user.holdings) {
      const p = POSITIONS[holding.ticker]
      if (!p) {
        console.log(`  ${holding.ticker.padEnd(4)}  no update data — skipping`)
        continue
      }

      // Add new snapshot
      await prisma.snapshot.create({
        data: {
          holdingId: holding.id,
          date:      SNAPSHOT_DATE,
          units:     p.units,
          price:     p.price,
          value:     p.value,
          currency:  "USD",
        },
      })
      console.log(`  ${holding.ticker.padEnd(4)}  snapshot added: ${p.units} units @ $${p.price} = SGD ${p.value.toLocaleString()}`)

      // Check if any trades already exist for this user+ticker
      const existingTrades = await prisma.trade.findMany({
        where: { userId: user.id, ticker: holding.ticker },
      })

      if (existingTrades.length === 0) {
        // No trades — insert a synthetic aggregate BUY representing full cost basis
        const avgPriceUsd = p.costSgd / p.units / FX
        await prisma.trade.create({
          data: {
            userId:  user.id,
            ticker:  holding.ticker,
            type:    "BUY",
            units:   p.units,
            price:   +avgPriceUsd.toFixed(4),
            amount:  p.costSgd,
            fxRate:  FX,
            date:    SNAPSHOT_DATE,
            note:    "Synthetic aggregate trade — imported from IBKR avg cost basis",
          },
        })
        console.log(`  ${holding.ticker.padEnd(4)}  trade inserted: ${p.units} units @ $${avgPriceUsd.toFixed(2)} avg (cost SGD ${p.costSgd.toLocaleString()})`)
      } else {
        const totalExistingUnits = existingTrades.reduce((s, t) =>
          s + (t.type === "BUY" ? t.units : -t.units), 0)
        console.log(`  ${holding.ticker.padEnd(4)}  ${existingTrades.length} existing trade(s), ~${totalExistingUnits.toFixed(0)} units — skipping trade insert`)
      }
    }

    console.log()
  }

  console.log(`FX rate used: ${FX} SGD/USD`)
  console.log("Done. Restart dev server or refresh browser to see updated values.")
}

main().catch(console.error).finally(() => prisma.$disconnect())
