/**
 * Boundary checker — Atlas Core ↔ SBR separation.
 *
 * Both portfolios now share the same fund universe (VWRA/EQAC/SMH/BTC/DBMFE), so
 * "SBR-only tickers" is no longer a meaningful boundary. What still matters:
 *
 *   1. Import boundary — SBR experience files must not import Atlas-only business
 *      logic (health engine, decision ladder, governance digest), and the Atlas
 *      engine must not import SBR-specific modules.
 *   2. A35 (the SGD bond anchor) is the one ticker that exists ONLY in SBR — it
 *      must never appear in Atlas-only engine files.
 *   3. Ownership routing — dutszm@gmail.com must map to silicon-brick-road, the
 *      Atlas owner and unknown emails to atlas-core (lib/constitutions.ts).
 *   4. SbrDashboard must only be rendered behind a silicon-brick-road gate.
 *
 * Run: npx tsx scripts/check-sbr-boundary.ts
 */

import * as fs from "fs"
import * as path from "path"
import { constitutionIdForEmail } from "../lib/constitutions"

const ROOT = path.resolve(__dirname, "..")
let violations = 0

function fail(msg: string, detail?: string) {
  console.error(`BOUNDARY VIOLATION — ${msg}`)
  if (detail) console.error(`  ${detail}`)
  violations++
}

// ─── 1+2. Static import/content rules ────────────────────────────────────────
// Each rule is { files, forbidden }: any file matching `files` must not contain
// a line matching any pattern in `forbidden`.
//
// SHARED INTERFACES (NextMove, DcaPlan, DcaAllocation, EngineMarket) live in
// lib/next-best-move.ts and are used by both portfolios as TYPE-only imports —
// those are allowed. The boundary blocks BUSINESS LOGIC, not shared types.
// lib/constitution.ts exports generic calendar utilities (getDealingWindow, etc.)
// used by both portfolios; those are also allowed.

const RULES: Array<{ name: string; files: RegExp; forbidden: RegExp[] }> = [
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
    // Both portfolios share VWRA/EQAC/SMH/BTC/DBMFE; A35 is the single ticker
    // that remains SBR-only. It must never leak into Atlas-only engine paths.
    name: "Atlas Core engine must not reference the SBR-only ticker A35",
    files: /\/(lib\/(constants|next-best-move|health|ladder|cycle|core-holdings)\.tsx?)/,
    forbidden: [/["']A35["']/],
  },
]

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

for (const rule of RULES) {
  const inScope = allFiles.filter((f) => rule.files.test(f.replace(/\\/g, "/")))
  for (const file of inScope) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/")
    const lines = fs.readFileSync(file, "utf8").split("\n")
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of rule.forbidden) {
        if (pattern.test(lines[i])) {
          fail(rule.name, `File: ${rel}:${i + 1}\n  Line: ${lines[i].trim()}`)
        }
      }
    }
  }
}

// ─── 3. Ownership routing ────────────────────────────────────────────────────
// The email → constitution map is what keeps Dami inside SBR and everyone else
// (including unknown emails) inside Atlas Core.

if (constitutionIdForEmail("dutszm@gmail.com") !== "silicon-brick-road") {
  fail('dutszm@gmail.com must map to "silicon-brick-road"')
}
if (constitutionIdForEmail("davidhamiltonsg@gmail.com") !== "atlas-core") {
  fail('davidhamiltonsg@gmail.com must map to "atlas-core"')
}
if (constitutionIdForEmail("someone-unknown@example.com") !== "atlas-core") {
  fail('unknown emails must default to "atlas-core"')
}
if (constitutionIdForEmail("  DUTSZM@GMAIL.COM  ") !== "silicon-brick-road") {
  fail("email → constitution mapping must be case/whitespace-insensitive")
}

// ─── 4. SbrDashboard rendered only behind a silicon-brick-road gate ──────────
// Every file that renders <SbrDashboard must contain an explicit
// silicon-brick-road constitution check on an earlier line than the render.

for (const file of allFiles) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/")
  if (!rel.startsWith("app/") && !rel.startsWith("components/")) continue // only UI render paths
  if (rel.startsWith("components/sbr/")) continue // the component's own module
  const lines = fs.readFileSync(file, "utf8").split("\n")
  const renderLine = lines.findIndex((l) => l.includes("<SbrDashboard"))
  if (renderLine === -1) continue
  const gateLine = lines.findIndex((l) => l.includes('=== "silicon-brick-road"'))
  if (gateLine === -1 || gateLine > renderLine) {
    fail(
      "SbrDashboard must only render behind a silicon-brick-road constitution gate",
      `File: ${rel}:${renderLine + 1} — no '=== "silicon-brick-road"' check before the render`,
    )
  }
}

if (violations === 0) {
  console.log("✓ Atlas ↔ SBR boundary clean — imports, A35, ownership routing, and SbrDashboard gating all verified.")
  process.exit(0)
} else {
  console.error(`\n${violations} boundary violation${violations === 1 ? "" : "s"} found. Fix before committing.`)
  process.exit(1)
}
