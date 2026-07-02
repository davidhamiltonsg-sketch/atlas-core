import { Shell } from "@/components/shell"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { constitutionIdForEmail } from "@/lib/constitutions"
import { SmartMoneyClient } from "@/components/smart-money/smart-money-client"

export default async function SmartMoneyPage({
  searchParams,
}: {
  searchParams: Promise<{ atlasOnly?: string }>
}) {
  const session = await getSession()
  if (!session) redirect("/login")
  if (constitutionIdForEmail(session.email) === "silicon-brick-road") redirect("/")
  const sp = await searchParams
  const initialAtlasOnly = sp?.atlasOnly === "true"

  return (
    <Shell
      title="Research"
      subtitle="Congressional & insider disclosures on your holdings — read-only intelligence"
      userName={session.name}
      isAdmin={session.role === "admin"}
    >
      <SmartMoneyClient initialAtlasOnly={initialAtlasOnly} />
    </Shell>
  )
}
