/**
 * Deletes all EtfLookThrough records that have obviously-bad sector/geo weights
 * (zeros where hardcoded fallbacks have significant values).
 *
 * Run with: npx tsx prisma/reset-look-through.ts
 *
 * After running, use the "Refresh look-through" button on the Reports page
 * to fetch fresh data from Yahoo Finance.
 */

import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import "dotenv/config"

const url = process.env.DATABASE_URL
const authToken = process.env.DATABASE_AUTH_TOKEN || undefined
if (!url) throw new Error("DATABASE_URL is not set")
const adapter = new PrismaLibSql({ url, authToken })
const db = new PrismaClient({ adapter })

const HARDCODED_SECTOR: Record<string, { semiconductor: number; digital: number }> = {
  VWRA: { semiconductor: 8,   digital: 35  },
  EQQQ: { semiconductor: 13,  digital: 65  },
  SEMI: { semiconductor: 100, digital: 90  },
  VFEA: { semiconductor: 12,  digital: 30  },
  BTC:  { semiconductor: 0,   digital: 0   },
}

const HARDCODED_GEO: Record<string, { us: number }> = {
  VWRA: { us: 62  },
  EQQQ: { us: 100 },
  SEMI: { us: 75  },
  VFEA: { us: 0   },
  BTC:  { us: 0   },
}

async function main() {
  const records = await db.etfLookThrough.findMany()
  const toDelete: string[] = []

  for (const lt of records) {
    try {
      const sw = JSON.parse(lt.sectorWeights) as { semiconductor: number; digital: number }
      const gw = JSON.parse(lt.geoWeights)    as { us: number }
      const cw = JSON.parse(lt.companyWeights) as Record<string, number>

      const fallbackSw = HARDCODED_SECTOR[lt.ticker]
      const fallbackGw = HARDCODED_GEO[lt.ticker]

      const sectorBad = fallbackSw && (
        (fallbackSw.semiconductor > 5  && (sw.semiconductor ?? 0) === 0) ||
        (fallbackSw.digital       > 20 && (sw.digital       ?? 0) === 0)
      )
      const geoBad = fallbackGw &&
        fallbackGw.us > 10 && (gw.us ?? 0) === 0

      const cwSum = Object.values(cw).reduce((s, v) => s + v, 0)
      const companyBad = lt.ticker !== "BTC" && cwSum === 0

      if (sectorBad || geoBad || companyBad) {
        console.log(`[${lt.ticker}] BAD record — sector bad=${sectorBad}, geo bad=${geoBad}, company bad=${companyBad} → deleting`)
        toDelete.push(lt.id)
      } else {
        console.log(`[${lt.ticker}] OK`)
      }
    } catch (e) {
      console.log(`[${lt.ticker}] Parse error — deleting malformed record`)
      toDelete.push(lt.id)
    }
  }

  if (toDelete.length === 0) {
    console.log("\nNo bad records found — nothing to delete.")
  } else {
    await db.etfLookThrough.deleteMany({ where: { id: { in: toDelete } } })
    console.log(`\nDeleted ${toDelete.length} bad record(s): ${toDelete.join(", ")}`)
    console.log("Use the 'Refresh look-through' button on the Reports page to re-fetch from Yahoo Finance.")
  }

  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
