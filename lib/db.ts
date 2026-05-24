import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"

function createPrismaClient() {
  const url = process.env.DATABASE_URL ?? "file:prisma/atlas.db"
  const authToken = process.env.DATABASE_AUTH_TOKEN ?? undefined
  const adapter = new PrismaLibSql({ url, authToken })
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  })
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db
