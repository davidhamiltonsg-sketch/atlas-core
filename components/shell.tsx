import { getSession } from "@/lib/session"
import { activePortfolioId } from "@/lib/active-portfolio"
import { ShellClient } from "./shell-client"

interface ShellProps {
  title: string
  subtitle?: string
  userName?: string
  isAdmin?: boolean
  children: React.ReactNode
}

// Server wrapper: resolves which constitution the logged-in user owns (Atlas Core vs Silicon
// Brick Road) and hands the branding/nav down to the client shell — so every page picks up the
// right identity and navigation without each page having to know the constitution.
export async function Shell({ title, subtitle, userName, isAdmin = false, children }: ShellProps) {
  const session = await getSession()
  const constitutionId = session ? await activePortfolioId(session) : "atlas-core"
  return (
    <ShellClient title={title} subtitle={subtitle} userName={userName} isAdmin={isAdmin} constitutionId={constitutionId}>
      {children}
    </ShellClient>
  )
}
