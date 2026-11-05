import { ChangeBoard } from "@/components/admin/change-board"
import { LoginCard } from "@/components/admin/login-card"
import { getAdminWorkspaceData } from "@/lib/admin"
import { requireAdminSession } from "@/lib/admin-auth"
import Link from "next/link"
import { redirect } from "next/navigation"
import { shouldRedirectAdminToLab } from "@/lib/prism-lab/admin-entry"
import { isPrismLabEnabled } from "@/lib/prism-lab/feature-flag"

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const errorParam = Array.isArray(resolvedSearchParams.error)
    ? resolvedSearchParams.error[0]
    : resolvedSearchParams.error
  const tabParam = Array.isArray(resolvedSearchParams.tab)
    ? resolvedSearchParams.tab[0]
    : resolvedSearchParams.tab

  // The bare entry leads to Lab. Check the session before redirecting so an
  // unauthenticated visitor still gets this page's login form, without loading
  // the expensive legacy board for an authenticated visitor.
  if (shouldRedirectAdminToLab(resolvedSearchParams, process.env.PRISM_LAB_ENABLED)) {
    const session = await requireAdminSession()
    if (session.ok) redirect("/admin/lab")
  }

  const board = await getAdminWorkspaceData()

  if (!board.ok) {
    const error =
      board.reason === "unauthorized"
        ? "That password did not authenticate against the API."
        : errorParam === "missing-password"
          ? "Enter the shared admin password."
          : board.reason === "error"
            ? "The board could not load the admin API."
            : undefined

    return <LoginCard error={error} />
  }

  return <>
    {isPrismLabEnabled(process.env.PRISM_LAB_ENABLED) && <nav aria-label="Workspace switcher" className="border-b border-border bg-card px-5 py-3 text-sm">
      <span className="text-muted-foreground">Legacy workspace · settings and configuration remain available here.</span>{" "}
      <Link href="/admin/lab" className="text-primary underline">Return to Prism Lab</Link>
    </nav>}
    <ChangeBoard data={board.data} initialTab={tabParam} />
  </>
}
