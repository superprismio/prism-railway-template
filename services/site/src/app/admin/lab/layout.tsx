import type { Metadata } from "next"

import { LoginCard } from "@/components/admin/login-card"
import { LabShell } from "@/components/prism-lab/lab-shell"
import { requireAdminSession } from "@/lib/admin-auth"
import { isPrismLabEnabled } from "@/lib/prism-lab/feature-flag"

export const metadata: Metadata = {
  title: "Lab | Prism Refactory",
  description: "The field-testable Prism operations workspace.",
}

export const dynamic = "force-dynamic"

export default async function LabLayout({ children }: { children: React.ReactNode }) {
  const enabled = isPrismLabEnabled(process.env.PRISM_LAB_ENABLED)
  const access = enabled ? await requireAdminSession() : null

  return (
    <LabShell enabled={enabled} capabilities={access?.ok ? access.capabilities : []}>
      {access?.ok ? children : <LoginCard error="Sign in to access the live Prism Lab workspace." returnTo="/admin/lab" />}
    </LabShell>
  )
}
