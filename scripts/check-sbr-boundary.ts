/**
 * Import boundary checker — Atlas Core ↔ SBR separation.
 *
 * Asserts that no file in the SBR domain imports from Atlas Core engine files, and no
 * file in the Atlas Core engine imports SBR tickers or SBR-specific modules.
 *
 * Run: npx tsx scripts/check-sbr-boundary.ts
 */

import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(__dirname, "..")

// ─── Boundary rules ──────────────────────────────────────────────────────────
// Each rule is { files, forbidden } where any file matching `files` must not
// import any path matching any pattern in `forbidden`.
//
// SHARED INTERFACES (NextMove, DcaPlan, DcaAllocation, EngineMarket) are in
// lib/next-best-move.ts and are used by both portfolios as TYPE-only imports
// — those are allowed. The boundary blocks BUSINESS LOGIC, not shared types.
//
// lib/constitution.ts exports generic calendar utilities (getDealingWindow, etc.)
// used by both portfolios alongside Atlas-specific constants. SBR files may import
// only the calendar utilities; importing Atlas-specific ladder or health code is forbidden.

const RULES: Array<{
  name: string
  files: RegExp
  forbidden: RegExp[]
}> = [
  {
    name: "SBR engine files must not import Atlas-only business logic modules",
    files: /\/(lib\/sbr[-_]|components\/sbr\/)/,
    forbidden: [
      /from ['"]@\/lib\/health['"]/, // Atlas 4-dimension health engine (not SBR)
      /from ['"]@\/lib\/ladder['"]/, // Atlas decision ladder
      /from ['"]@\/lib\/governance-digest['"]/, // Atlas governance digest (not SBR)
    ],
  },
  {
    name: "Atlas Core engine must not import SBR-specific modules",
    files: /\/(lib\/(next-best-move|health|ladder|governance-digest)\.ts)/,
    forbidden: [
      /from ['"]@\/lib\/sbr[-_]/, // any lib/sbr-* module
    ],
  },
  {
    name: "Atlas Core engine must not reference SBR-only tickers as string literals",
    files: /\/(lib\/(constants|next-best-move|health|ladder)\.ts)/,
    forbidden: [
      /"VWRA"/, // SBR-only ticker
      /"A35"/,  // SBR-only ticker
    ],
  },
]

// ─── Scan ─────────────────────────────────────────────────────────────────────

function getAllTs(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory() && !["node_modules", ".next", ".git"].includes(e.name)) {
      files.push(...getAllTs(full))
    } else if (e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".tsx"))) {
      files.push(full)
    }
  }
  return files
}

const allFiles = getAllTs(ROOT)
let violations = 0

for (const rule of RULES) {
  const inScope = allFiles.filter((f) => rule.files.test(f.replace(/\\/g, "/")))
  for (const file of inScope) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/")
    const content = fs.readFileSync(file, "utf8")
    const lines = content.split("\n")
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of rule.forbidden) {
        if (pattern.test(lines[i])) {
          console.error(`BOUNDARY VIOLATION — ${rule.name}`)
          console.error(`  File: ${rel}:${i + 1}`)
          console.error(`  Line: ${lines[i].trim()}`)
          violations++
        }
      }
    }
  }
}

if (violations === 0) {
  console.log("✓ Atlas ↔ SBR import boundary clean — no violations found.")
  process.exit(0)
} else {
  console.error(`\n${violations} boundary violation${violations === 1 ? "" : "s"} found. Fix before committing.`)
  process.exit(1)
}
