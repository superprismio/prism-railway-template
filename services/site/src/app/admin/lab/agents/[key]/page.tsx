import Link from "next/link"

import { AgentConsoleWorkspace } from "@/components/prism-lab/agent-console-workspace"
import { RequestInboxUnavailable } from "@/components/prism-lab/request-inbox"
import { getAdminWorkspaceData } from "@/lib/admin"
import { getAgentProfile, listAgentProfileActivity, listAgentProfileSessions } from "@/lib/app-core"
import { isPrismLabEnabled } from "@/lib/prism-lab/feature-flag"

export default async function LabAgentPage({ params }: { params: Promise<{ key: string }> }) {
  if (!isPrismLabEnabled(process.env.PRISM_LAB_ENABLED)) return null
  const workspace = await getAdminWorkspaceData()
  if (!workspace.ok) return <RequestInboxUnavailable reason={workspace.reason} />
  if (!workspace.data.session.capabilities.includes("canRunAgent")) return <RequestInboxUnavailable reason="unauthorized" />
  const profile = getAgentProfile((await params).key)
  if (!profile) return <div className="p-8"><h1 className="text-xl font-semibold">Agent not found</h1><Link href="/admin/lab/agents" className="mt-4 inline-block text-sm underline">Return to Agents</Link></div>
  return <AgentConsoleWorkspace key={profile.id} profile={profile} activity={listAgentProfileActivity(profile.id, 100)} sessions={listAgentProfileSessions(profile.id, 100)} canManageSettings={workspace.data.session.capabilities.includes("canManageSettings")} />
}
