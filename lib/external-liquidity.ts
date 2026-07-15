import { db } from "@/lib/db"

// SBR liquidity pillar — the owner's standing confirmation that an emergency fund exists
// OUTSIDE this portfolio. Stored as append-only BehaviourLog markers (same pattern as
// "committee-minute") instead of a User column, so no schema migration is ever required.
// The latest marker wins.
const MARKER_TYPE = "liquidity-confirmation"

export async function getExternalLiquidityVerified(userId: string): Promise<boolean> {
  const latest = await db.behaviourLog.findFirst({
    where: { userId, type: MARKER_TYPE },
    orderBy: { date: "desc" },
    select: { note: true },
  })
  return latest?.note.startsWith("Confirmed") ?? false
}

export async function setExternalLiquidityVerified(userId: string, verified: boolean): Promise<void> {
  await db.behaviourLog.create({
    data: {
      userId,
      type: MARKER_TYPE,
      note: verified
        ? "Confirmed the emergency fund outside this portfolio is funded."
        : "Withdrew the emergency-fund confirmation.",
    },
  })
}
