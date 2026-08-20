import { LabConsole } from "@/components/prism-lab/lab-console"
import { RequestInboxUnavailable } from "@/components/prism-lab/request-inbox"
import { getAdminWorkspaceData } from "@/lib/admin"
import { isPrismLabEnabled } from "@/lib/prism-lab/feature-flag"
import { configurationPromptForFocus } from "@/lib/prism-lab/console-promotion"

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export default async function LabConsolePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!isPrismLabEnabled(process.env.PRISM_LAB_ENABLED)) return null
  const workspace = await getAdminWorkspaceData()
  if (!workspace.ok) return <RequestInboxUnavailable reason={workspace.reason} />
  if (!workspace.data.session.capabilities.includes("canRunAgent")) {
    return <RequestInboxUnavailable reason="unauthorized" />
  }
  const rawFocus = (await searchParams)?.focus
  const focus = Array.isArray(rawFocus) ? rawFocus[0] : rawFocus
  const workflows = (workspace.data.workflows ?? []).map((workflow) => ({
    key: workflow.key,
    name: workflow.name,
    enabled: workflow.enabled,
    targetRequired: workflow.key === "change-request-default"
      || (isRecord(workflow.definition.target) && workflow.definition.target.required === true),
  }))
  return (
    <LabConsole
      workflows={workflows}
      targets={workspace.data.targetApps.map((target) => ({ id: target.id, name: target.name, agentEnabled: target.agentEnabled }))}
      initialPrompt={configurationPromptForFocus(focus)}
      canCreateAgents={workspace.data.session.capabilities.includes("canManageSettings")}
    />
  )
}
