import { NextResponse } from "next/server"
import path from "path"
import fs from "fs"

export async function GET() {
  const cwd = process.cwd()
  const rawUrl = process.env.DATABASE_URL ?? "(not set)"
  const relativePath = rawUrl.startsWith("file:") ? rawUrl.slice(5) : rawUrl
  const resolved = path.resolve(cwd, relativePath)
  const dirPath = path.dirname(resolved)

  return NextResponse.json({
    cwd,
    DATABASE_URL: rawUrl,
    relativePath,
    resolved,
    dirExists: fs.existsSync(dirPath),
    fileExists: fs.existsSync(resolved),
    dirname: __dirname,
  })
}
