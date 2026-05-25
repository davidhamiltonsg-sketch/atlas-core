import { PrismaClient } from "@prisma/client"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import path from "path"

function createPrismaClient() {
  const rawUrl = process.env.DATABASE_URL ?? "file:prisma/atlas.db"
  // Strip the "file:" prefix and resolve to an absolute path
  const relativePath = rawUrl.startsWith("file:") ? rawUrl.slice(5) : rawUrl
  const absolutePath = path.resolve(process.cwd(), relativePath)
  const adapter = new PrismaBetterSqlite3({ url: `file:${absolutePath}` })
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
