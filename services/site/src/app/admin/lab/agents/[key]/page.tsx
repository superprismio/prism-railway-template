import Link from "next/link"
import { Activity, ArrowLeft, Bot, Cable, MessageSquareText, ShieldCheck, UserRound } from "lucide-react"

import { CodexConsole } from "@/components/admin/codex-console"
import { AgentBindingForm } from "@/components/prism-lab/agent-binding-form"
import { RequestInboxUnavailable } from "@/components/prism-lab/request-inbox"
import { Badge } from "@/components/ui/badge"
import { getAdminWorkspaceData } from "@/lib/admin"
import { getAgentProfile, listAgentProfileActivity, listAgentProfileSessions } from "@/lib/app-core"
import { isPrismLabEnabled } from "@/lib/prism-lab/feature-flag"

function formatDate(value: string | null) {
  if (!value) return "Never"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default async function LabAgentPage({ params }: { params: Promise<{ key: string }> }) {
  if (!isPrismLabEnabled(process.env.PRISM_LAB_ENABLED)) return null
  const workspace = await getAdminWorkspaceData()
  if (!workspace.ok) return <RequestInboxUnavailable reason={workspace.reason} />
  if (!workspace.data.session.capabilities.includes("canRunAgent")) return <RequestInboxUnavailable reason="unauthorized" />
  const profile = getAgentProfile((await params).key)
  if (!profile) return <div className="p-8"><h1 className="text-xl font-semibold">Agent not found</h1><Link href="/admin/lab/agents" className="mt-4 inline-block text-sm underline">Return to Agents</Link></div>
  const activity = listAgentProfileActivity(profile.id, 100)
  const sessions = listAgentProfileSessions(profile.id, 100)
  const ownerLabel = profile.owner.type === "workspace" ? "Workspace" : profile.owner.type === "agent" ? getAgentProfile(profile.owner.agentProfileId || "")?.name || "Another agent" : profile.stewards.find((item) => item.role === "owner")?.displayName || "User"
  return (
    <div className="px-4 py-5 sm:px-6 lg:px-8"><div className="mx-auto max-w-7xl">
      <header className="border-b border-border/60 pb-5"><Link href="/admin/lab/agents" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Agents</Link><div className="mt-4 flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><Bot className="text-primary" aria-hidden="true" /><h1 className="text-2xl font-semibold sm:text-3xl">{profile.name}</h1><Badge variant="outline">v{profile.version}</Badge>{profile.systemKey ? <Badge>Built in</Badge> : null}</div><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{profile.description || "No mandate recorded"}</p></div><Badge variant={profile.status === "active" ? "outline" : "muted"}>{profile.status}</Badge></div></header>
      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Agent overview">
        <div className="border border-border/60 p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4" />Owned by</div><div className="mt-2 text-sm font-medium">{ownerLabel}</div></div>
        <div className="border border-border/60 p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><UserRound className="h-4 w-4" />Human stewards</div><div className="mt-2 text-sm font-medium">{profile.stewards.map((item) => item.displayName || item.userId).join(", ") || "Workspace administrators"}</div></div>
        <div className="border border-border/60 p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Cable className="h-4 w-4" />Surfaces</div><div className="mt-2 text-sm font-medium">Console · {profile.bindings.length} external</div></div>
        <div className="border border-border/60 p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Activity className="h-4 w-4" />Observed activity</div><div className="mt-2 text-sm font-medium">{sessions.length} sessions · {activity.filter((item) => item.kind === "run").length} runs</div></div>
      </section>
      <section className="mt-6 border border-border/60 bg-card/35"><div className="border-b border-border/60 px-4 py-3"><div className="flex items-center gap-2"><MessageSquareText className="text-primary" /><h2 className="font-semibold">{profile.systemKey === "admin-agent" ? "Admin Console" : `${profile.name} Console`}</h2></div><p className="mt-1 text-xs text-muted-foreground">Authenticated session-scoped conversation. Authorized workspace operators can inspect its transcript.</p></div><CodexConsole isActive agentProfileKey={profile.key} executionMode={profile.systemKey === "admin-agent" ? "orchestrator" : "worker"} /></section>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <section><h2 className="font-semibold">Activity</h2><p className="mt-1 text-xs text-muted-foreground">Conversations and workflow-step execution attributed to this agent.</p><div className="mt-3 divide-y divide-border/60 border border-border/60">{activity.length ? activity.map((item) => <div key={item.id} className="p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-medium">{item.title}</div><Badge variant="outline">{item.status}</Badge></div><div className="mt-1 text-xs text-muted-foreground">{item.description} · {formatDate(item.occurredAt)}</div><div className="mt-2 flex flex-wrap gap-3 text-xs">{item.actorDisplayName ? <span>Participant · {item.actorDisplayName}</span> : null}{item.executionMode ? <span>Mode · {item.executionMode}</span> : null}{item.sessionId ? <Link className="underline" href={`/admin/lab/agents/${encodeURIComponent(profile.key)}/sessions/${encodeURIComponent(item.sessionId)}`}>View session</Link> : null}{item.requestNumber ? <Link className="underline" href={`/admin/lab/requests/${item.requestNumber}#selected-request-workspace`}>Request #{item.requestNumber}</Link> : null}</div></div>) : <div className="p-5 text-sm text-muted-foreground">No attributed activity yet. Legacy sessions and runs remain labeled legacy rather than silently assigned.</div>}</div></section>
        <section><h2 className="font-semibold">Channels and interfaces</h2><p className="mt-1 text-xs text-muted-foreground">Console is always available. Each external surface resolves to one primary agent.</p><div className="mt-3 divide-y divide-border/60 border border-border/60">{profile.bindings.length ? profile.bindings.map((binding) => <div key={binding.id} className="p-3 text-sm"><div className="flex justify-between gap-3"><span className="font-medium">{binding.label || binding.surfaceKey}</span><Badge variant="outline">{binding.surfaceType}</Badge></div><div className="mt-1 font-mono text-xs text-muted-foreground">{binding.surfaceKey}</div></div>) : <div className="p-4 text-sm text-muted-foreground">Console only</div>}</div>{workspace.data.session.capabilities.includes("canManageSettings") && !profile.systemKey ? <div className="mt-3"><AgentBindingForm profileKey={profile.key} /></div> : null}</section>
      </div>
    </div></div>
  )
}
