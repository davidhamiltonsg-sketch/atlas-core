import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { AdminUsersClient } from "./client"

async function getUsers() {
  const users = await db.user.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { holdings: true } } },
  })
  return users.map((u: typeof users[number]) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
    holdingCount: u._count.holdings,
  }))
}

export default async function AdminUsers() {
  const session = await getSession()
  if (!session) redirect("/login")
  if (session.role !== "admin") redirect("/")

  const users = await getUsers()

  return (
    <Shell title="User Management" subtitle="Create and manage portfolio users" userName={session.name}>
      <AdminUsersClient users={users} currentUserId={session.userId} />
    </Shell>
  )
}
