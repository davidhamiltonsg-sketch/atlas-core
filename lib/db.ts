import { PrismaClient } from "@prisma/client"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import path from "path"

function getDbPath(): string {
  const url = process.env.DATABASE_URL ?? "file:./prisma/atlas.db"
  if (url.startsWith("file:")) {
    const filePath = url.slice(5)
    return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)
  }
  return path.resolve(process.cwd(), "prisma/atlas.db")
}

function createPrismaClient() {
  const dbPath = getDbPath()
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` })
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
