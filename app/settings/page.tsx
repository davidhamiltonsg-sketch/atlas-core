import { Shell } from "@/components/shell"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { SettingsClient } from "./client"

export default async function SettingsPage() {
  const session = await getSession()
  if (!session) redirect("/login")

  return (
    <Shell title="Settings" subtitle="Account preferences and security" userName={session.name}>
      <SettingsClient
        initialName={session.name}
        initialEmail={session.email}
        role={session.role}
      />
    </Shell>
  )
}
