import Link from "next/link"
import { ArrowLeft, LogOut } from "lucide-react"

import { LoginCard } from "@/components/admin/login-card"
import { MemoryExplorerWorkspace } from "@/components/admin/memory-explorer-workspace"
import { AdminHeader } from "@/components/admin/admin-header"
import { Button } from "@/components/ui/button"
import { getAdminWorkspaceData } from "@/lib/admin"

export default async function AdminMemoryPage() {
  const workspace = await getAdminWorkspaceData()

  if (!workspace.ok) {
    const error =
      workspace.reason === "unauthorized"
        ? "That password did not authenticate against the API."
        : workspace.reason === "missing-password"
          ? "Enter the shared admin password."
          : "The admin API could not be reached."

    return <LoginCard error={error} />
  }

  return (
    <main className="min-h-screen w-full bg-background text-foreground">
      <AdminHeader
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/admin">
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Change Board</span>
              </Link>
            </Button>
            <form action="/admin/logout" method="post">
              <Button variant="outline" type="submit">
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Exit admin</span>
              </Button>
            </form>
          </>
        }
      />

      <MemoryExplorerWorkspace setup={workspace.data.setup} />
    </main>
  )
}
