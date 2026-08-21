import type { Metadata } from "next"

import { LoginCard } from "@/components/admin/login-card"
import { LabShell } from "@/components/prism-lab/lab-shell"
import { requireAdminSession } from "@/lib/admin-auth"
import { isPrismLabEnabled } from "@/lib/prism-lab/feature-flag"
import { listAgentProfiles } from "@/lib/app-core"

export const metadata: Metadata = {
  title: "Lab | Prism Refactory",
  description: "The field-testable Prism operations workspace.",
}

export const dynamic = "force-dynamic"

export default async function LabLayout({ children }: { children: React.ReactNode }) {
  const enabled = isPrismLabEnabled(process.env.PRISM_LAB_ENABLED)
  const access = enabled ? await requireAdminSession() : null
  const agents = access?.ok && access.capabilities.includes("canRunAgent")
    ? listAgentProfiles().map(({ key, name, avatarUrl, systemKey, status }) => ({ key, name, avatarUrl, systemKey, status }))
    : []

  return (
    <LabShell enabled={enabled} capabilities={access?.ok ? access.capabilities : []} agents={agents}>
      {access?.ok ? children : <LoginCard error="Sign in to access the live Prism Lab workspace." returnTo="/admin/lab" />}
    </LabShell>
  )
}
