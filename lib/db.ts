import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"

function createPrismaClient() {
  const url = process.env.DATABASE_URL
  const authToken = process.env.DATABASE_AUTH_TOKEN || undefined

  if (!url) throw new Error("DATABASE_URL is not set")

  const adapter = new PrismaLibSql({ url, authToken })
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  })
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export function getDb(): PrismaClient {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = createPrismaClient()
  return globalForPrisma.prisma
}

// Preserve the existing `db.user...` API while deferring client creation until a query
// actually runs. Next.js may import pages during build-time route analysis without runtime
// database credentials; production requests still fail immediately if DATABASE_URL is absent.
export const db = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getDb()
    const value = client[property as keyof PrismaClient]
    return typeof value === "function" ? value.bind(client) : value
  },
})
