import { ActivityView } from "@/components/prism-lab/activity-view"
import { RequestInboxUnavailable } from "@/components/prism-lab/request-inbox"
import { getAdminWorkspaceData } from "@/lib/admin"
import { buildCrossRequestActivity } from "@/lib/prism-lab/activity-read-model"
import { isPrismLabEnabled } from "@/lib/prism-lab/feature-flag"
import { buildLabRequestListItems } from "@/lib/prism-lab/request-read-model"

export default async function LabActivityPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!isPrismLabEnabled(process.env.PRISM_LAB_ENABLED)) return null
  const workspace = await getAdminWorkspaceData()
  if (!workspace.ok) return <RequestInboxUnavailable reason={workspace.reason} />
  if (!workspace.data.session.capabilities.includes("canViewRequests")) {
    return <RequestInboxUnavailable reason="unauthorized" />
  }

  const rawView = (await searchParams)?.view
  const view = (Array.isArray(rawView) ? rawView[0] : rawView) === "attention" ? "attention" : "all"
  const requests = buildLabRequestListItems(workspace.data, workspace.data.session.capabilities)
  const allItems = buildCrossRequestActivity(requests)
  const attentionCount = allItems.filter((item) => item.state === "attention").length
  const items = view === "attention" ? allItems.filter((item) => item.state === "attention") : allItems

  return <ActivityView items={items} attentionCount={attentionCount} view={view} />
}
