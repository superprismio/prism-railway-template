"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { Activity, Bot, Boxes, CheckCircle2, ChevronDown, ChevronUp, GitBranch, LoaderCircle, ShieldAlert, Sparkles, X } from "lucide-react"

import { CodexConsole } from "@/components/admin/codex-console"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type {
  AdminBoardData,
  ChangeRequestExecutionRecord,
  ChangeRequestRecord,
  TargetAppRecord,
  TargetEnvironmentRecord,
} from "@/lib/admin"

const boardColumns = [
  { key: "submitted", label: "Inbox" },
  { key: "triaging", label: "Triaging" },
  { key: "ready-for-agent", label: "Ready" },
  { key: "in-progress", label: "Working" },
  { key: "awaiting-review", label: "Review" },
] as const

const triageStatuses = [
  { value: "submitted", label: "Inbox" },
  { value: "triaging", label: "Triaging" },
  { value: "ready-for-agent", label: "Ready for agent" },
  { value: "in-progress", label: "Working" },
  { value: "awaiting-review", label: "Awaiting review" },
  { value: "changes-requested", label: "Changes requested" },
  { value: "approved", label: "Approved" },
  { value: "closed", label: "Closed" },
] as const

function priorityVariant(priority: string) {
  if (priority === "urgent") return "default"
  if (priority === "high") return "secondary"
  return "muted"
}

function environmentForRequest(
  request: ChangeRequestRecord,
  targetEnvironments: TargetEnvironmentRecord[]
) {
  return targetEnvironments.find((environment) => environment.id === request.targetEnvironmentId) ?? null
}

function targetAppForRequest(request: ChangeRequestRecord, targetApps: TargetAppRecord[]) {
  return targetApps.find((targetApp) => targetApp.id === request.targetAppId) ?? null
}

function isoLabel(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatDurationFrom(startedAt: string | null, nowMs: number) {
  if (!startedAt) return null
  const startedMs = new Date(startedAt).getTime()
  if (Number.isNaN(startedMs)) return null

  const totalSeconds = Math.max(0, Math.floor((nowMs - startedMs) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    return `${hours}h ${remainingMinutes}m`
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }

  return `${seconds}s`
}

function latestTraceEntry(execution: ChangeRequestExecutionRecord | null) {
  const trace = Array.isArray(execution?.meta?.runtimeTrace) ? execution.meta.runtimeTrace : []
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const entry = trace[index]
    if (
      entry &&
      typeof entry === "object" &&
      typeof entry.message === "string" &&
      entry.message.trim()
    ) {
      return {
        at: typeof entry.at === "string" ? entry.at : null,
        kind: typeof entry.kind === "string" ? entry.kind : "runtime",
        message: entry.message.trim(),
      }
    }
  }

  return null
}

function describeExecutionStage(execution: ChangeRequestExecutionRecord | null) {
  if (!execution) {
    return "No active execution"
  }

  const traceEntry = latestTraceEntry(execution)
  if (traceEntry) {
    return `${traceEntry.kind}: ${traceEntry.message}`
  }

  if (execution.branchName) {
    return `Working on branch ${execution.branchName}`
  }

  return "Execution started and waiting for runtime updates"
}

function executionBranchUrl(execution: ChangeRequestExecutionRecord | null) {
  const candidate = execution?.meta?.branchUrl
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null
}

function executionDeployUrl(
  execution: ChangeRequestExecutionRecord | null,
  targetEnvironment?: TargetEnvironmentRecord | null
) {
  const direct = execution?.deployUrl
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim()
  }

  const staticUrl = execution?.meta?.deployStaticUrl
  if (typeof staticUrl === "string" && staticUrl.trim()) {
    return staticUrl.startsWith("http") ? staticUrl.trim() : `https://${staticUrl.trim()}`
  }

  const fallback = targetEnvironment?.baseUrl
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback.trim()
  }

  return null
}

function githubCompareUrl(
  targetApp: TargetAppRecord | null,
  baseBranch: string | null | undefined,
  branchName: string | null | undefined
) {
  if (!targetApp?.repoUrl || !baseBranch || !branchName) {
    return null
  }

  const match = targetApp.repoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/)
  if (!match) {
    return null
  }

  const [, owner, repo] = match
  return `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(branchName)}?expand=1`
}

type AgentThreadMessage = {
  id: string
  role: string
  source: string
  content: string
  createdAt: string
}

type AgentThreadSession = {
  id: string
}

function RequestCard({
  request,
  targetApps,
  targetEnvironments,
  onOpen,
  isExpanded,
  onToggleExpanded,
}: {
  request: ChangeRequestRecord
  targetApps: TargetAppRecord[]
  targetEnvironments: TargetEnvironmentRecord[]
  onOpen: (request: ChangeRequestRecord) => void
  isExpanded: boolean
  onToggleExpanded: (requestId: string) => void
}) {
  const targetApp = targetAppForRequest(request, targetApps)
  const targetEnvironment = environmentForRequest(request, targetEnvironments)

  return (
    <Card className="border-border/70 bg-card/95 transition hover:border-foreground/30 hover:shadow-[0_16px_40px_-28px_rgba(26,31,44,0.45)]">
      <CardHeader className="gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <button type="button" onClick={() => onOpen(request)} className="min-w-0 flex-1 text-left">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Request #{request.requestNumber}</p>
              <CardTitle className="mt-1 line-clamp-2 text-base leading-tight">{request.title}</CardTitle>
            </div>
          </button>
          <div className="flex items-center gap-2">
            {isExpanded ? <Badge variant={priorityVariant(request.priority)}>{request.priority}</Badge> : null}
            <Button type="button" variant="outline" className="h-8 px-2" onClick={() => onToggleExpanded(request.id)}>
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        {isExpanded ? <CardDescription className="text-sm leading-6">{request.description}</CardDescription> : null}
      </CardHeader>
      {isExpanded ? (
        <CardContent className="space-y-3 p-4 pt-0 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{request.requestType}</Badge>
            <Badge variant="muted">{targetApp?.name ?? request.targetAppSlug ?? "Unknown target"}</Badge>
            {targetEnvironment ? <Badge variant="muted">{targetEnvironment.slug}</Badge> : null}
          </div>
          {request.agentRecommendation ? (
            <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/70 px-3 py-2 text-xs leading-5 text-emerald-900">
              <span className="font-medium">Suggested:</span> {request.agentRecommendation}
            </div>
          ) : null}
          <div className="grid gap-2 text-muted-foreground">
            <div className="flex items-center gap-2">
              <GitBranch className="h-3.5 w-3.5" />
              <span>{targetEnvironment?.branch ?? targetApp?.defaultBranch ?? "No branch configured"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Bot className="h-3.5 w-3.5" />
              <span>{targetEnvironment?.agentWritable ? "Agent writable" : "Human-only target"}</span>
            </div>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-3 text-xs leading-5 text-muted-foreground">
            <div>Updated: {isoLabel(request.updatedAt) ?? "Unknown"}</div>
            {request.triageSummary ? (
              <div className="mt-2 whitespace-pre-wrap">
                <span className="font-medium text-foreground">Triage:</span> {request.triageSummary}
              </div>
            ) : null}
          </div>
        </CardContent>
      ) : null}
    </Card>
  )
}

function RequestDetailsModal({
  request,
  targetApp,
  targetEnvironment,
  isPending,
  error,
  onClose,
  onSave,
}: {
  request: ChangeRequestRecord
  targetApp: TargetAppRecord | null
  targetEnvironment: TargetEnvironmentRecord | null
  isPending: boolean
  error: string | null
  onClose: () => void
  onSave: (payload: { status: string; triageSummary: string; agentRecommendation: string }) => void
}) {
  const configuredBaseBranch = targetEnvironment?.branch ?? targetApp?.defaultBranch ?? null
  const [status, setStatus] = useState(request.status)
  const [triageSummary, setTriageSummary] = useState(request.triageSummary ?? "")
  const [agentRecommendation, setAgentRecommendation] = useState(request.agentRecommendation ?? "")
  const [threadSession, setThreadSession] = useState<AgentThreadSession | null>(null)
  const [threadMessages, setThreadMessages] = useState<AgentThreadMessage[]>([])
  const [commentDraft, setCommentDraft] = useState("")
  const [threadError, setThreadError] = useState<string | null>(null)
  const [executions, setExecutions] = useState<ChangeRequestExecutionRecord[]>([])
  const [isDraftDirty, setIsDraftDirty] = useState(false)
  const [isCommentPending, startCommentTransition] = useTransition()
  const [isContinuePending, startContinueTransition] = useTransition()
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now())

  useEffect(() => {
    setStatus(request.status)
    setTriageSummary(request.triageSummary ?? "")
    setAgentRecommendation(request.agentRecommendation ?? "")
    setIsDraftDirty(false)
  }, [request.id, request.updatedAt])

  useEffect(() => {
    let cancelled = false

    async function loadThread() {
      try {
        const response = await fetch(`/admin/change-requests/${request.id}/agent-thread`, { cache: "no-store" })
        if (!response.ok) {
          throw new Error("Could not load request thread")
        }

        const payload = (await response.json()) as {
          ok?: boolean
          session?: AgentThreadSession | null
          messages?: AgentThreadMessage[]
          error?: string
        }

        if (cancelled) return
        if (payload.ok === false) {
          throw new Error(payload.error || "Could not load request thread")
        }

        setThreadSession(payload.session ?? null)
        setThreadMessages(Array.isArray(payload.messages) ? payload.messages : [])
        setThreadError(null)
      } catch (error) {
        if (!cancelled) {
          setThreadError(error instanceof Error ? error.message : "Could not load request thread")
        }
      }
    }

    loadThread()
    return () => {
      cancelled = true
    }
  }, [request.id])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setLiveNowMs(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    if (!executions.some((execution) => execution.status === "running")) {
      return
    }

    let cancelled = false

    async function pollLiveState() {
      try {
        const [threadResponse, executionResponse] = await Promise.all([
          fetch(`/admin/change-requests/${request.id}/agent-thread`, { cache: "no-store" }),
          fetch(`/admin/change-requests/${request.id}/executions`, { cache: "no-store" }),
        ])

        if (!threadResponse.ok || !executionResponse.ok || cancelled) {
          return
        }

        const threadPayload = (await threadResponse.json()) as {
          session?: AgentThreadSession | null
          messages?: AgentThreadMessage[]
        }
        const executionPayload = (await executionResponse.json()) as {
          executions?: ChangeRequestExecutionRecord[]
        }

        if (cancelled) return

        setThreadSession(threadPayload.session ?? null)
        setThreadMessages(Array.isArray(threadPayload.messages) ? threadPayload.messages : [])
        setExecutions(Array.isArray(executionPayload.executions) ? executionPayload.executions : [])
      } catch {
        // Keep the current modal state and try again on the next interval.
      }
    }

    const intervalId = window.setInterval(pollLiveState, 2500)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [executions, request.id])

  const activeExecution = useMemo(
    () => executions.find((execution) => execution.status === "running") ?? null,
    [executions]
  )
  const activeExecutionElapsed = formatDurationFrom(activeExecution?.startedAt ?? null, liveNowMs)
  const activeExecutionStage = describeExecutionStage(activeExecution)
  const activeExecutionBranchUrl = executionBranchUrl(activeExecution)
  const activeExecutionDeployUrl = executionDeployUrl(activeExecution, targetEnvironment)
  const activeExecutionPrUrl = githubCompareUrl(
    targetApp,
    (typeof activeExecution?.meta?.baseBranch === "string" ? activeExecution.meta.baseBranch : null) ?? configuredBaseBranch,
    activeExecution?.branchName ?? null
  )

  useEffect(() => {
    let cancelled = false

    async function loadExecutions() {
      try {
        const response = await fetch(`/admin/change-requests/${request.id}/executions`, { cache: "no-store" })
        if (!response.ok) {
          throw new Error("Could not load execution log")
        }

        const payload = (await response.json()) as {
          ok?: boolean
          executions?: ChangeRequestExecutionRecord[]
          error?: string
        }

        if (cancelled) return
        if (payload.ok === false) {
          throw new Error(payload.error || "Could not load execution log")
        }

        setExecutions(Array.isArray(payload.executions) ? payload.executions : [])
      } catch (error) {
        if (!cancelled) {
          setThreadError((current) => current ?? (error instanceof Error ? error.message : "Could not load execution log"))
        }
      }
    }

    loadExecutions()
    return () => {
      cancelled = true
    }
  }, [request.id])

  async function refreshThread() {
    const response = await fetch(`/admin/change-requests/${request.id}/agent-thread`, { cache: "no-store" })
    if (!response.ok) {
      throw new Error("Could not refresh request thread")
    }

    const payload = (await response.json()) as {
      session?: AgentThreadSession | null
      messages?: AgentThreadMessage[]
    }
    setThreadSession(payload.session ?? null)
    setThreadMessages(Array.isArray(payload.messages) ? payload.messages : [])
  }

  async function refreshExecutions() {
    const response = await fetch(`/admin/change-requests/${request.id}/executions`, { cache: "no-store" })
    if (!response.ok) {
      throw new Error("Could not refresh execution log")
    }

    const payload = (await response.json()) as {
      executions?: ChangeRequestExecutionRecord[]
    }
    setExecutions(Array.isArray(payload.executions) ? payload.executions : [])
  }

  function handleAddComment() {
    const content = commentDraft.trim()
    if (!content) return

    setThreadError(null)
    startCommentTransition(async () => {
      try {
        const response = await fetch(`/admin/change-requests/${request.id}/comments`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ content }),
        })

        const payload = (await response.json()) as {
          ok?: boolean
          error?: string
          session?: AgentThreadSession | null
          messages?: AgentThreadMessage[]
        }

        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "Could not add comment")
        }

        setCommentDraft("")
        setThreadSession(payload.session ?? threadSession)
        setThreadMessages(Array.isArray(payload.messages) ? payload.messages : [])
      } catch (error) {
        setThreadError(error instanceof Error ? error.message : "Could not add comment")
      }
    })
  }

  function handleContinueAgent() {
    const latestComment = [...threadMessages]
      .reverse()
      .find((message) => message.source === "site-comment" && message.content.trim())
      ?.content
      .trim() ?? null

    const prompt = [
      `Continue work on change request #${request.requestNumber}: ${request.title}.`,
      `Current request status: ${request.status}.`,
      latestComment
        ? `Most recent admin comment to follow: ${latestComment}`
        : "No new admin comment was provided; continue from the existing request context and thread history.",
      request.status === "awaiting-review"
        ? "This request is currently in review. Apply the review feedback if needed, continue the work, update the request state if appropriate, and leave a detailed summary comment."
        : "Use the latest request context and comments, continue the work, update the request state if appropriate, and leave a detailed summary comment.",
    ].join("\n")

    setThreadError(null)
    startContinueTransition(async () => {
      try {
        const response = await fetch("/admin/responses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            input: [{ role: "user", content: prompt }],
            session_id: threadSession?.id ?? null,
            linked_change_request_id: request.id,
            linked_target_environment_id: request.targetEnvironmentId,
            requested_skills: ["change-request-ops", "target-deploy-ops"],
          }),
        })

        const payload = (await response.json()) as {
          error?: string
          session_id?: string
        }

        if (!response.ok) {
          throw new Error(payload.error || "Could not continue agent")
        }

        if (payload.session_id) {
          setThreadSession({ id: payload.session_id })
        }
        await refreshThread()
        await refreshExecutions()
      } catch (error) {
        setThreadError(error instanceof Error ? error.message : "Could not continue agent")
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[#1d2433]/55 px-4 py-8 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-border/70 bg-background shadow-[0_28px_90px_-42px_rgba(26,31,44,0.7)]">
        <div className="sticky top-0 z-10 border-b border-border/70 bg-background/95 px-6 py-5 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Request #{request.requestNumber}</Badge>
                <Badge variant={priorityVariant(request.priority)}>{request.priority}</Badge>
                <Badge variant="muted">{request.status}</Badge>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">{request.title}</h2>
              <p className="text-sm text-muted-foreground">
                {targetApp?.name ?? request.targetAppSlug ?? "Unknown target"}
                {targetEnvironment ? ` / ${targetEnvironment.name}` : ""}
              </p>
            </div>
            <Button type="button" variant="outline" onClick={onClose}>
              <X className="h-4 w-4" />
              Close
            </Button>
          </div>
        </div>

        <div className="grid flex-1 gap-6 overflow-y-auto p-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-6">
            <Card className="rounded-[24px] border-border/60 bg-card/90">
              <CardHeader>
                <CardTitle>Request Details</CardTitle>
                <CardDescription>Original request plus the target context currently assigned to it.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="rounded-2xl border border-border/70 bg-background/70 p-4 leading-7">
                  {request.description}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-border/70 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Type</p>
                    <p className="mt-2 font-medium">{request.requestType}</p>
                  </div>
                  <div className="rounded-2xl border border-border/70 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Priority</p>
                    <p className="mt-2 font-medium">{request.priority}</p>
                  </div>
                  <div className="rounded-2xl border border-border/70 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Target App</p>
                    <p className="mt-2 font-medium">{targetApp?.name ?? request.targetAppSlug ?? "Unknown"}</p>
                  </div>
                  <div className="rounded-2xl border border-border/70 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Environment</p>
                    <p className="mt-2 font-medium">{targetEnvironment?.name ?? "Not assigned"}</p>
                  </div>
                  <div className="rounded-2xl border border-border/70 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Base Branch</p>
                    <p className="mt-2 font-medium">{configuredBaseBranch ?? "Not configured"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[24px] border-border/60 bg-card/90">
              <CardHeader>
                <CardTitle>Triage Notes</CardTitle>
                <CardDescription>
                  Capture the proposed scope, suggested changes, and the point where the request is ready to route.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="triage-status">
                    Status
                  </label>
                  <select
                    id="triage-status"
                    value={status}
                    onChange={(event) => {
                      setStatus(event.target.value)
                      setIsDraftDirty(true)
                    }}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    {triageStatuses.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="triage-summary">
                    Triage Summary
                  </label>
                  <Textarea
                    id="triage-summary"
                    value={triageSummary}
                    onChange={(event) => {
                      setTriageSummary(event.target.value)
                      setIsDraftDirty(true)
                    }}
                    placeholder="Summarize what needs to happen, any sequencing, and review notes."
                    className="min-h-32"
                  />
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium" htmlFor="agent-recommendation">
                    <Sparkles className="h-4 w-4" />
                    Suggested Changes Summary
                  </label>
                  <Textarea
                    id="agent-recommendation"
                    value={agentRecommendation}
                    onChange={(event) => {
                      setAgentRecommendation(event.target.value)
                      setIsDraftDirty(true)
                    }}
                    placeholder="Short summary of the proposed changes shown on the card and used for routing."
                    className="min-h-24"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="rounded-[24px] border-border/60 bg-card/90">
              <CardHeader>
                <CardTitle>Request Thread</CardTitle>
                <CardDescription>Comments and agent replies linked to this change request.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {activeExecution ? (
                  <div className="rounded-2xl border border-sky-200/70 bg-sky-50/80 p-4 text-sm text-sky-950">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        <span className="font-medium">Current Run</span>
                      </div>
                      <Badge variant="outline">{activeExecution.status}</Badge>
                    </div>
                    <div className="mt-3 space-y-2">
                      <p className="leading-6">{activeExecutionStage}</p>
                      <div className="grid gap-1 text-xs text-sky-900/75">
                        {activeExecutionElapsed ? <div>Elapsed: {activeExecutionElapsed}</div> : null}
                        {activeExecution.startedAt ? <div>Started: {isoLabel(activeExecution.startedAt)}</div> : null}
                        {configuredBaseBranch ? <div>Base branch: {configuredBaseBranch}</div> : null}
                        {activeExecution.branchName ? (
                          <div>
                            Branch:{" "}
                            {activeExecutionBranchUrl ? (
                              <a
                                href={activeExecutionBranchUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="font-medium underline underline-offset-2"
                              >
                                {activeExecution.branchName}
                              </a>
                            ) : (
                              activeExecution.branchName
                            )}
                          </div>
                        ) : null}
                        {activeExecutionPrUrl ? (
                          <div>
                            PR:{" "}
                            <a
                              href={activeExecutionPrUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium underline underline-offset-2"
                            >
                              Open compare / PR
                            </a>
                          </div>
                        ) : null}
                        {activeExecutionDeployUrl ? (
                          <div>
                            Preview:{" "}
                            <a
                              href={activeExecutionDeployUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium underline underline-offset-2"
                            >
                              {activeExecutionDeployUrl}
                            </a>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="max-h-[260px] space-y-3 overflow-y-auto rounded-2xl border border-border/70 bg-background/70 p-4">
                  {threadMessages.length ? (
                    threadMessages.map((message) => (
                      <div
                        key={message.id}
                        className={`rounded-2xl px-4 py-3 text-sm leading-6 ${
                          message.role === "assistant"
                            ? "border border-border/70 bg-card text-foreground"
                            : "bg-[#1d2433] text-white"
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.16em]">
                          <Badge variant={message.role === "assistant" ? "outline" : "secondary"}>
                            {message.source === "site-comment" ? "comment" : message.role}
                          </Badge>
                          <span className={message.role === "assistant" ? "text-muted-foreground" : "text-white/70"}>
                            {isoLabel(message.createdAt) ?? ""}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                      No comments or agent replies yet for this request.
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="request-comment">
                    Add Comment
                  </label>
                  <Textarea
                    id="request-comment"
                    value={commentDraft}
                    onChange={(event) => setCommentDraft(event.target.value)}
                    placeholder="Leave context, a review note, or a clarification without triggering the agent."
                    className="min-h-24"
                  />
                  <div className="flex justify-end">
                    <Button type="button" variant="outline" onClick={handleAddComment} disabled={isCommentPending}>
                      {isCommentPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                      {isCommentPending ? "Saving" : "Add comment"}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Continue Agent</label>
                  <p className="text-sm text-muted-foreground">
                    Uses the latest admin comment on this request, plus the current request status and linked thread history.
                  </p>
                  <div className="flex justify-end">
                    <Button type="button" onClick={handleContinueAgent} disabled={isContinuePending}>
                      {isContinuePending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                      {isContinuePending ? "Running" : "Continue agent"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[24px] border-border/60 bg-card/90">
              <CardHeader>
                <CardTitle>Suggested Changes Details</CardTitle>
                <CardDescription>
                  Use this scrollable area for fuller triage notes, implementation direction, and what Codex should change.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                  <Textarea
                    value={agentRecommendation}
                    onChange={(event) => {
                      setAgentRecommendation(event.target.value)
                      setIsDraftDirty(true)
                    }}
                    placeholder="List the proposed edits, areas to touch, expected outcome, and anything the agent should avoid."
                    className="min-h-[420px] max-h-[420px] resize-none overflow-y-auto border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[24px] border-border/60 bg-card/90">
              <CardHeader>
                <CardTitle>Lifecycle</CardTitle>
                <CardDescription>Current timestamps visible to the board.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-2xl border border-border/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Created</p>
                  <p className="mt-2">{isoLabel(request.createdAt) ?? "Unknown"}</p>
                </div>
                <div className="rounded-2xl border border-border/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Triaged</p>
                  <p className="mt-2">{isoLabel(request.triagedAt) ?? "Not yet"}</p>
                </div>
                <div className="rounded-2xl border border-border/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Approved For Work</p>
                  <p className="mt-2">{isoLabel(request.approvedForWorkAt) ?? "Not yet"}</p>
                </div>
                <div className="rounded-2xl border border-border/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Last Updated</p>
                  <p className="mt-2">{isoLabel(request.updatedAt) ?? "Unknown"}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[24px] border-border/60 bg-card/90">
              <CardHeader>
                <CardTitle>Execution Log</CardTitle>
                <CardDescription>Recent agent runs, status changes, and failure details for this request.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-[320px] space-y-3 overflow-y-auto">
                  {executions.length ? (
                    executions.map((execution) => (
                      <div key={execution.id} className="rounded-2xl border border-border/70 bg-background/70 p-4 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <Badge variant={execution.status === "completed" ? "secondary" : execution.status === "running" ? "default" : "outline"}>
                              {execution.status}
                            </Badge>
                            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                              {execution.actorType}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">{isoLabel(execution.updatedAt) ?? ""}</span>
                        </div>
                        {execution.summary ? <p className="mt-3 whitespace-pre-wrap leading-6">{execution.summary}</p> : null}
                        {execution.errorMessage ? (
                          <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">
                            {execution.errorMessage}
                          </div>
                        ) : null}
                        <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                          {execution.branchName ? (
                            <div>
                              Branch:{" "}
                              {executionBranchUrl(execution) ? (
                                <a
                                  href={executionBranchUrl(execution) ?? "#"}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-medium underline underline-offset-2"
                                >
                                  {execution.branchName}
                                </a>
                              ) : (
                                execution.branchName
                              )}
                            </div>
                          ) : null}
                          {githubCompareUrl(
                            targetApp,
                            (typeof execution.meta?.baseBranch === "string" ? execution.meta.baseBranch : null) ?? configuredBaseBranch,
                            execution.branchName
                          ) ? (
                            <div>
                              PR:{" "}
                              <a
                                href={
                                  githubCompareUrl(
                                    targetApp,
                                    (typeof execution.meta?.baseBranch === "string" ? execution.meta.baseBranch : null) ?? configuredBaseBranch,
                                    execution.branchName
                                  ) ?? "#"
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="font-medium underline underline-offset-2"
                              >
                                Open compare / PR
                              </a>
                            </div>
                          ) : null}
                          {execution.commitSha ? <div>Commit: {execution.commitSha}</div> : null}
                          {executionDeployUrl(execution, targetEnvironment) ? (
                            <div>
                              Preview:{" "}
                              <a
                                href={executionDeployUrl(execution, targetEnvironment) ?? "#"}
                                target="_blank"
                                rel="noreferrer"
                                className="font-medium underline underline-offset-2"
                              >
                                {executionDeployUrl(execution, targetEnvironment)}
                              </a>
                            </div>
                          ) : null}
                          {execution.startedAt ? <div>Started: {isoLabel(execution.startedAt)}</div> : null}
                          {execution.finishedAt ? <div>Finished: {isoLabel(execution.finishedAt)}</div> : null}
                        </div>
                        {Array.isArray(execution.meta?.runtimeTrace) && execution.meta.runtimeTrace.length ? (
                          <div className="mt-3 rounded-xl border border-border/60 bg-muted/30 p-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                              Execution Trace
                            </div>
                            <div className="mt-2 max-h-40 space-y-2 overflow-y-auto font-mono text-[11px] leading-5 text-muted-foreground">
                              {execution.meta.runtimeTrace.map((entry, index) => {
                                if (!entry || typeof entry !== "object") {
                                  return null
                                }

                                const at = typeof entry.at === "string" ? entry.at : null
                                const kind = typeof entry.kind === "string" ? entry.kind : "runtime"
                                const message = typeof entry.message === "string" ? entry.message : ""

                                if (!message.trim()) {
                                  return null
                                }

                                return (
                                  <div key={`${execution.id}-trace-${index}`} className="whitespace-pre-wrap">
                                    [{at ?? "unknown"}] {kind}: {message}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                      No execution records yet for this request.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="sticky bottom-0 z-10 border-t border-border/70 bg-background/95 px-6 py-4 backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            {error || threadError ? (
              <p className="text-sm text-destructive">{error ?? threadError}</p>
            ) : isDraftDirty ? (
              <p className="text-sm text-muted-foreground">Unsaved changes</p>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => onSave({ status, triageSummary, agentRecommendation })}
                disabled={isPending}
              >
                {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                {isPending ? "Saving" : "Save request"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ChangeBoard({ data: initialData }: { data: AdminBoardData }) {
  const [data, setData] = useState(initialData)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [expandedRequestIds, setExpandedRequestIds] = useState<string[]>([])
  const [isSaving, startSaving] = useTransition()
  const [modalError, setModalError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function refreshBoard() {
      try {
        const response = await fetch("/admin/board", { cache: "no-store" })
        if (!response.ok) {
          return
        }

        const payload = (await response.json()) as { ok: true; data: AdminBoardData }
        if (!cancelled && payload.ok) {
          setData(payload.data)
        }
      } catch {
        // Leave the current board state in place and try again on the next interval.
      }
    }

    refreshBoard()
    const intervalId = window.setInterval(refreshBoard, 2500)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  const closedCount = data.changeRequests.filter((request) =>
    ["approved", "rejected", "closed"].includes(request.status)
  ).length

  const selectedRequest = useMemo(
    () => data.changeRequests.find((request) => request.id === selectedRequestId) ?? null,
    [data.changeRequests, selectedRequestId]
  )

  async function refreshOnce() {
    const response = await fetch("/admin/board", { cache: "no-store" })
    if (!response.ok) {
      throw new Error("Board refresh failed")
    }

    const payload = (await response.json()) as { ok: true; data: AdminBoardData }
    if (!payload.ok) {
      throw new Error("Board refresh failed")
    }

    setData(payload.data)
  }

  function handleSaveTriage(payload: { status: string; triageSummary: string; agentRecommendation: string }) {
    if (!selectedRequest) return

    setModalError(null)
    startSaving(async () => {
      try {
        const response = await fetch(`/admin/change-requests/${selectedRequest.id}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        })

        const responsePayload = (await response.json()) as { ok?: boolean; error?: string }
        if (!response.ok || responsePayload.ok === false) {
          throw new Error(responsePayload.error || "Could not save triage")
        }

        await refreshOnce()
      } catch (error) {
        setModalError(error instanceof Error ? error.message : "Could not save triage")
      }
    })
  }

  function toggleExpandedRequest(requestId: string) {
    setExpandedRequestIds((current) =>
      current.includes(requestId) ? current.filter((value) => value !== requestId) : [...current, requestId]
    )
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(236,110,57,0.18),transparent_26rem),radial-gradient(circle_at_top_right,rgba(90,182,255,0.14),transparent_24rem),linear-gradient(180deg,#f4f0e8,#f7f4ee_42%,#efe8dd)] text-foreground">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <section className="grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
          <Card className="overflow-hidden border-none bg-transparent shadow-none">
            <CardContent className="rounded-[28px] border border-border/60 bg-card/90 p-6 shadow-[0_24px_80px_-36px_rgba(26,31,44,0.45)] backdrop-blur md:p-8">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                    <Activity className="h-3.5 w-3.5" />
                    Prism Change Board
                  </div>
                  <div className="space-y-2">
                    <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">
                      Triage requests, route them to review branches, and keep production out of the blast radius.
                    </h1>
                    <p className="max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
                      This board now refreshes live so requests can move across lanes while Codex is triaging or working them.
                    </p>
                  </div>
                </div>
                <form action="/admin/logout" method="post">
                  <Button variant="outline" type="submit">
                    Exit admin
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-border/60 bg-[#1d2433] text-white shadow-[0_24px_80px_-36px_rgba(26,31,44,0.6)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-white">Board Snapshot</CardTitle>
              <CardDescription className="text-white/70">Seeded target inventory and current request volume.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3 lg:grid-cols-2">
              <div className="rounded-2xl bg-white/6 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-white/55">Target apps</p>
                <p className="mt-2 text-3xl font-semibold">{data.targetApps.length}</p>
              </div>
              <div className="rounded-2xl bg-white/6 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-white/55">Environments</p>
                <p className="mt-2 text-3xl font-semibold">{data.targetEnvironments.length}</p>
              </div>
              <div className="rounded-2xl bg-white/6 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-white/55">Closed requests</p>
                <p className="mt-2 text-3xl font-semibold">{closedCount}</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.4fr_420px]">
          <div className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-5">
              {boardColumns.map((column) => {
                const requests = data.changeRequests.filter((request) => request.status === column.key)

                return (
                  <div key={column.key} className="rounded-[24px] border border-border/60 bg-card/85 p-3 backdrop-blur">
                    <div className="mb-3 flex items-center justify-between px-1">
                      <div>
                        <p className="text-sm font-semibold">{column.label}</p>
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{requests.length} cards</p>
                      </div>
                      <Badge variant="outline">{requests.length}</Badge>
                    </div>
                    <div className="max-h-[70vh] space-y-3 overflow-y-auto overflow-x-hidden pr-1">
                      {requests.length ? (
                        requests.map((request) => (
                          <RequestCard
                            key={request.id}
                            request={request}
                            targetApps={data.targetApps}
                            targetEnvironments={data.targetEnvironments}
                            onOpen={(nextRequest) => setSelectedRequestId(nextRequest.id)}
                            isExpanded={expandedRequestIds.includes(request.id)}
                            onToggleExpanded={toggleExpandedRequest}
                          />
                        ))
                      ) : (
                        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                          No requests
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <CodexConsole />
          </div>

          <div className="space-y-6">
            <Card className="rounded-[24px] border-border/60 bg-card/90">
              <CardHeader>
                <CardTitle>New Change Request</CardTitle>
                <CardDescription>Bootstrap form posting through the site to the API.</CardDescription>
              </CardHeader>
              <CardContent>
                <form action="/admin/requests" method="post" className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="title">
                      Title
                    </label>
                    <Input id="title" name="title" placeholder="Fix mobile treasury panel spacing" required />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium" htmlFor="requestType">
                        Type
                      </label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                        defaultValue="bug"
                        id="requestType"
                        name="requestType"
                      >
                        <option value="bug">Bug</option>
                        <option value="feature">Feature</option>
                        <option value="content">Content</option>
                        <option value="design">Design</option>
                        <option value="config">Config</option>
                        <option value="ops">Ops</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium" htmlFor="priority">
                        Priority
                      </label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                        defaultValue="normal"
                        id="priority"
                        name="priority"
                      >
                        <option value="low">Low</option>
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="targetAppId">
                      Target app
                    </label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      id="targetAppId"
                      name="targetAppId"
                      required
                    >
                      {data.targetApps.map((targetApp) => (
                        <option key={targetApp.id} value={targetApp.id}>
                          {targetApp.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="description">
                      Description
                    </label>
                    <Textarea
                      id="description"
                      name="description"
                      placeholder="Describe the issue, expected behavior, and any review constraints."
                      required
                    />
                  </div>
                  <Button className="w-full" type="submit">
                    Create draft request
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="rounded-[24px] border-border/60 bg-card/90">
              <CardHeader>
                <CardTitle>Target Inventory</CardTitle>
                <CardDescription>Seeded apps and environments available to the board.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {data.targetApps.map((targetApp) => {
                  const environments = data.targetEnvironments.filter((environment) => environment.targetAppId === targetApp.id)
                  return (
                    <div key={targetApp.id} className="space-y-3 rounded-2xl border border-border/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{targetApp.name}</p>
                          <p className="text-sm text-muted-foreground">{targetApp.slug}</p>
                        </div>
                        <Badge variant={targetApp.agentEnabled ? "secondary" : "outline"}>
                          {targetApp.agentEnabled ? "agent enabled" : "disabled"}
                        </Badge>
                      </div>
                      <div className="space-y-2">
                        {environments.map((environment) => (
                          <div key={environment.id} className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-sm">
                            <div className="flex items-center gap-2">
                              <Boxes className="h-4 w-4 text-muted-foreground" />
                              <span>{environment.name}</span>
                              <Badge variant="outline">{environment.kind}</Badge>
                            </div>
                            <div className="flex items-center gap-2 text-muted-foreground">
                              {environment.agentWritable ? (
                                <span className="inline-flex items-center gap-1">
                                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                  writable
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  <ShieldAlert className="h-4 w-4 text-amber-700" />
                                  locked
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </div>
        </section>
      </div>

      {selectedRequest ? (
        <RequestDetailsModal
          request={selectedRequest}
          targetApp={targetAppForRequest(selectedRequest, data.targetApps)}
          targetEnvironment={environmentForRequest(selectedRequest, data.targetEnvironments)}
          isPending={isSaving}
          error={modalError}
          onClose={() => {
            setSelectedRequestId(null)
            setModalError(null)
          }}
          onSave={handleSaveTriage}
        />
      ) : null}
    </main>
  )
}
