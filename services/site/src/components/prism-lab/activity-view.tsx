import Link from "next/link"
import { AlertTriangle, CheckCircle2, Clock3, GitBranch, Loader2 } from "lucide-react"

import { RequestInboxRefresh } from "@/components/prism-lab/request-inbox-refresh"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import type { LabCrossRequestActivity } from "@/lib/prism-lab/activity-read-model"
import { cn } from "@/lib/utils"

function displayTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "Unknown time"
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date)
}

function ActivityIcon({ state }: { state: LabCrossRequestActivity["state"] }) {
  if (state === "attention") return <AlertTriangle aria-hidden="true" />
  if (state === "running") return <Loader2 className="animate-spin" aria-hidden="true" />
  if (state === "completed") return <CheckCircle2 aria-hidden="true" />
  return <Clock3 aria-hidden="true" />
}

export function ActivityView({
  items,
  conversations,
  attentionCount,
  view,
}: {
  items: LabCrossRequestActivity[]
  conversations: Array<{ id: string; source: string; title: string | null; messageCount: number; lastMessageAt: string | null; updatedAt: string; createdByDisplayName: string | null; agentKey: string; agentName: string }>
  attentionCount: number
  view: "all" | "attention"
}) {
  return (
    <div className="px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-col gap-3 border-b border-border/60 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              <span>Live instance</span><span aria-hidden="true">·</span><span>Activity</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Cross-request operations</h1>
            <p className="mt-1 text-sm text-muted-foreground">Current operational changes across canonical requests</p>
          </div>
          <RequestInboxRefresh />
        </header>

        <nav aria-label="Activity views" className="flex flex-wrap gap-2 py-4">
          <Link href="/admin/lab/activity" aria-current={view === "all" ? "page" : undefined} className={buttonVariants({ variant: view === "all" ? "secondary" : "ghost", size: "sm" })}>All activity</Link>
          <Link href="/admin/lab/activity?view=attention" aria-current={view === "attention" ? "page" : undefined} className={buttonVariants({ variant: view === "attention" ? "secondary" : "ghost", size: "sm" })}>
            Needs attention <Badge variant={attentionCount ? "destructive" : "muted"}>{attentionCount}</Badge>
          </Link>
        </nav>

        <section aria-label={view === "attention" ? "Requests needing attention" : "Recent request activity"} className="border border-border/60 bg-card/35">
          {items.length ? (
            <ol className="divide-y divide-border/60">
              {items.map((item) => (
                <li key={item.request.id} className={cn("p-4", item.state === "attention" && "bg-destructive/5")}>
                  <article className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3">
                    <div className={cn("flex h-9 w-9 items-center justify-center rounded-full border bg-background", item.state === "attention" ? "border-destructive/40 text-destructive" : "text-primary")}>
                      <ActivityIcon state={item.state} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/admin/lab/requests/${item.request.requestNumber}#selected-request-workspace`} className="font-semibold hover:text-primary hover:underline">#{item.request.requestNumber} · {item.request.title}</Link>
                        <Badge variant={item.state === "attention" ? "destructive" : "outline"}>{item.state}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{item.summary}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><GitBranch aria-hidden="true" />{item.request.phase.label}</span>
                        <span>{item.request.source.label}</span>
                        <time dateTime={item.occurredAt}>{displayTime(item.occurredAt)}</time>
                      </div>
                    </div>
                  </article>
                </li>
              ))}
            </ol>
          ) : (
            <div className="px-6 py-16 text-center">
              <CheckCircle2 className="mx-auto h-7 w-7 text-primary" aria-hidden="true" />
              <h2 className="mt-3 font-semibold">{view === "attention" ? "No requests need attention" : "No request activity yet"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {view === "attention"
                  ? "The current canonical snapshot has no blockers, failures, or attention states."
                  : "The canonical request set is empty. New activity will appear here after a request is created."}
              </p>
            </div>
          )}
        </section>
        {view === "all" ? <section className="mt-6 border border-border/60 bg-card/35" aria-label="Recent agent conversations"><div className="border-b border-border/60 px-4 py-3"><h2 className="font-semibold">Agent conversations</h2><p className="mt-1 text-xs text-muted-foreground">Observable Console, Memory, and external-channel sessions</p></div>{conversations.length ? <ol className="divide-y divide-border/60">{conversations.map((session) => <li key={session.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><Link href={`/admin/lab/agents/${encodeURIComponent(session.agentKey)}/sessions/${encodeURIComponent(session.id)}`} className="font-medium hover:text-primary hover:underline">{session.title || `${session.agentName} session`}</Link><p className="mt-1 text-xs text-muted-foreground">{session.agentName} · {session.source} · {session.createdByDisplayName || "Unknown participant"}</p></div><div className="text-right text-xs text-muted-foreground"><Badge variant="outline">{session.messageCount} messages</Badge><div className="mt-1">{displayTime(session.lastMessageAt ?? session.updatedAt)}</div></div></div></li>)}</ol> : <p className="p-5 text-sm text-muted-foreground">No observable agent conversations yet.</p>}</section> : null}
      </div>
    </div>
  )
}
