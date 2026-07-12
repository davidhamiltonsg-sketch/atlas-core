import type { SessionPayload } from "@/lib/session"

/** Cross-portfolio viewing is allowed; changing another owner's ledger is admin-only. */
export function assertCanMutateOwner(session: SessionPayload, ownerId: string): void {
  if (session.role !== "admin" && session.userId !== ownerId) {
    throw new Error("Read-only access: only the portfolio owner or an administrator can make this change.")
  }
}
