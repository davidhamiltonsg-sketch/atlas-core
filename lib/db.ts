import { PrismaClient } from "@prisma/client"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import Database from "better-sqlite3"
import path from "path"

function createPrismaClient() {
  const rawUrl = process.env.DATABASE_URL ?? "file:prisma/atlas.db"
  // Strip "file:" prefix if present, then resolve to absolute path
  const relativePath = rawUrl.startsWith("file:") ? rawUrl.slice(5) : rawUrl
  const absolutePath = path.resolve(process.cwd(), relativePath)
  // Pass the Database instance directly to avoid URL parsing issues on Windows
  const sqlite = new Database(absolutePath)
  const adapter = new PrismaBetterSqlite3(sqlite)
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
