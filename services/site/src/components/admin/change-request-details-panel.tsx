"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  CheckCircle2,
  Circle,
  GitBranch,
  LoaderCircle,
  PlayCircle,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  ChangeRequestExecutionRecord,
  ChangeRequestRecord,
  TargetAppRecord,
  TargetEnvironmentRecord,
} from "@/lib/admin";

import {
  describeExecutionStage,
  executionBranchUrl,
  executionDeployUrl,
  formatDurationFrom,
  githubCompareUrl,
  isoLabel,
  priorityVariant,
  triageStatuses,
  type AgentThreadMessage,
  type AgentThreadSession,
} from "./change-request-utils";

const commandCenterSteps = [
  { status: "submitted", label: "Inbox" },
  { status: "triaging", label: "Triage" },
  { status: "ready-for-agent", label: "Ready" },
  { status: "in-progress", label: "Working" },
  { status: "awaiting-review", label: "Awaiting Review" },
  { status: "approved", label: "Approved" },
];

function commandCenterStepIndex(status: string) {
  if (status === "changes-requested") {
    return commandCenterSteps.findIndex((step) => step.status === "triaging");
  }

  if (status === "closed") {
    return commandCenterSteps.length;
  }

  const index = commandCenterSteps.findIndex((step) => step.status === status);
  return index >= 0 ? index : 0;
}

function CommandCenter({
  status,
  triageSummary,
  agentRecommendation,
  targetApp,
  reviewBranchName,
  reviewBranchUrl,
  reviewCompareUrl,
  isPending,
  onTriage,
  onApproveSolution,
  onApproveReview,
  onRequestChanges,
  onCloseRequest,
}: {
  status: string;
  triageSummary: string;
  agentRecommendation: string;
  targetApp: TargetAppRecord | null;
  reviewBranchName: string | null;
  reviewBranchUrl: string | null;
  reviewCompareUrl: string | null;
  isPending: boolean;
  onTriage: () => void;
  onApproveSolution: () => void;
  onApproveReview: () => void;
  onRequestChanges: (comment: string) => void;
  onCloseRequest: () => void;
}) {
  const [reviewComment, setReviewComment] = useState("");
  const currentStepIndex = commandCenterStepIndex(status);
  const isReviewCommentRequired = status === "awaiting-review";
  const canRequestChanges = reviewComment.trim().length > 0;

  return (
    <Card className="rounded-none border-border/70 bg-background shadow-none">
      <CardHeader className="space-y-4">
        <div className="relative grid gap-3 md:grid-cols-6">
          <div className="absolute left-[calc(100%/12)] right-[calc(100%/12)] top-4 hidden h-px bg-border md:block" />
          <div
            className="absolute left-[calc(100%/12)] top-4 hidden h-px bg-primary md:block"
            style={{
              width:
                currentStepIndex >= commandCenterSteps.length
                  ? "calc(100% - (100% / 6))"
                  : `calc((100% - (100% / 6)) * ${
                      currentStepIndex / (commandCenterSteps.length - 1)
                    })`,
            }}
          />
          {commandCenterSteps.map((step, index) => {
            const isComplete = status === "closed" || currentStepIndex > index;
            const isCurrent = currentStepIndex === index;

            return (
              <div key={step.status} className="relative flex gap-3 md:block">
                {index < commandCenterSteps.length - 1 ? (
                  <div
                    className={`absolute left-4 top-8 h-[calc(100%+0.75rem)] w-px md:hidden ${
                      isComplete ? "bg-primary" : "bg-border"
                    }`}
                  />
                ) : null}
                <div
                  className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border md:mx-auto ${
                    isComplete
                      ? "border-primary bg-primary text-primary-foreground"
                      : isCurrent
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  {isComplete ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : isCurrent ? (
                    <PlayCircle className="h-4 w-4" />
                  ) : (
                    <Circle className="h-3 w-3" />
                  )}
                </div>
                <div className="min-w-0 md:mt-3 md:text-center">
                  <p
                    className={`text-sm font-medium ${
                      isCurrent ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {step.label}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {status === "submitted" ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <p className="font-medium">New change request</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                This request is waiting for triage. Prism can review the
                request, summarize the scope, and propose the implementation
                path.
              </p>
            </div>
            <Button type="button" onClick={onTriage} disabled={isPending}>
              {isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : null}
              Triage
            </Button>
          </div>
        ) : null}

        {status === "triaging" || status === "changes-requested" ? (
          <div className="space-y-4">
            <div>
              <p className="font-medium">
                {status === "changes-requested"
                  ? "Changes requested"
                  : "Triage in progress"}
              </p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                The agent is preparing or revising the implementation plan.
              </p>
            </div>
          </div>
        ) : null}

        {status === "ready-for-agent" ? (
          <div className="space-y-4">
            <div>
              <p className="font-medium">Ready for approval</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Review the triage output, then approve it to start
                implementation.
              </p>
            </div>
            <div className="space-y-4">
              <div className="rounded-none border border-border/70 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Triage Summary
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                  {triageSummary || "No triage summary yet."}
                </p>
              </div>
              <div className="rounded-none border border-border/70 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Suggested Changes Summary
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                  {agentRecommendation || "No suggested changes yet."}
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={onApproveSolution}
                disabled={isPending}
              >
                {isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : null}
                Approve
              </Button>
            </div>
          </div>
        ) : null}

        {status === "in-progress" ? (
          <div>
            <p className="font-medium">Working</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              The agent is implementing this request.
            </p>
          </div>
        ) : null}

        {status === "awaiting-review" ? (
          <div className="space-y-4">
            <div>
              <p className="font-medium">Awaiting review</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                The code is ready for review. Check the branch, then approve or
                request changes with feedback for the agent.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-none border border-border/70 p-4 text-sm">
              {targetApp?.repoUrl ? (
                <a
                  href={targetApp.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium underline underline-offset-2"
                >
                  Repository
                </a>
              ) : null}
              {reviewBranchName ? (
                <span className="inline-flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  {reviewBranchUrl ? (
                    <a
                      href={reviewBranchUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium underline underline-offset-2"
                    >
                      {reviewBranchName}
                    </a>
                  ) : (
                    <span className="font-medium">{reviewBranchName}</span>
                  )}
                </span>
              ) : null}
              {reviewCompareUrl ? (
                <a
                  href={reviewCompareUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium underline underline-offset-2"
                >
                  Open compare / PR
                </a>
              ) : null}
              {!targetApp?.repoUrl && !reviewBranchName && !reviewCompareUrl ? (
                <span className="text-muted-foreground">
                  No branch link is available yet.
                </span>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="review-change-comment">Review Feedback</Label>
              <Textarea
                id="review-change-comment"
                value={reviewComment}
                onChange={(event) => setReviewComment(event.target.value)}
                placeholder="Describe what needs to change before approval."
                className="min-h-24"
              />
            </div>

            <div className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onRequestChanges(reviewComment);
                  setReviewComment("");
                }}
                disabled={
                  isPending || (isReviewCommentRequired && !canRequestChanges)
                }
              >
                {isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : null}
                Request changes
              </Button>
              <Button
                type="button"
                onClick={onApproveReview}
                disabled={isPending}
              >
                {isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : null}
                Approve
              </Button>
            </div>
          </div>
        ) : null}

        {status === "approved" ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <p className="font-medium">Approved</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                This request has passed review and can be closed.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={onCloseRequest}
              disabled={isPending}
            >
              {isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : null}
              Close request
            </Button>
          </div>
        ) : null}

        {status === "closed" ? (
          <div>
            <p className="font-medium">Closed</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              This request is complete.
            </p>
          </div>
        ) : null}

        {![
          "submitted",
          "triaging",
          "changes-requested",
          "ready-for-agent",
          "in-progress",
          "awaiting-review",
          "approved",
          "closed",
        ].includes(status) ? (
          <div>
            <p className="font-medium">{status}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              This request is in a custom state.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function RequestDetailsPanel({
  request,
  targetApp,
  targetEnvironment,
  isPending,
  error,
  onClose,
  onSave,
}: {
  request: ChangeRequestRecord;
  targetApp: TargetAppRecord | null;
  targetEnvironment: TargetEnvironmentRecord | null;
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (payload: {
    status: string;
    triageSummary: string;
    agentRecommendation: string;
  }) => void;
}) {
  const configuredBaseBranch =
    targetEnvironment?.branch ?? targetApp?.defaultBranch ?? null;
  const [status, setStatus] = useState(request.status);
  const [triageSummary, setTriageSummary] = useState(
    request.triageSummary ?? "",
  );
  const [agentRecommendation, setAgentRecommendation] = useState(
    request.agentRecommendation ?? "",
  );
  const [threadSession, setThreadSession] = useState<AgentThreadSession | null>(
    null,
  );
  const [threadMessages, setThreadMessages] = useState<AgentThreadMessage[]>(
    [],
  );
  const [commentDraft, setCommentDraft] = useState("");
  const [threadError, setThreadError] = useState<string | null>(null);
  const [executions, setExecutions] = useState<ChangeRequestExecutionRecord[]>(
    [],
  );
  const [isDraftDirty, setIsDraftDirty] = useState(false);
  const [isCommentPending, startCommentTransition] = useTransition();
  const [isContinuePending, startContinueTransition] = useTransition();
  const [isCommandPending, startCommandTransition] = useTransition();
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());

  useEffect(() => {
    setStatus(request.status);
    setTriageSummary(request.triageSummary ?? "");
    setAgentRecommendation(request.agentRecommendation ?? "");
    setIsDraftDirty(false);
  }, [request.id, request.updatedAt]);

  useEffect(() => {
    let cancelled = false;

    async function loadThread() {
      try {
        const response = await fetch(
          `/admin/change-requests/${request.id}/agent-thread`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error("Could not load request thread");
        }

        const payload = (await response.json()) as {
          ok?: boolean;
          session?: AgentThreadSession | null;
          messages?: AgentThreadMessage[];
          error?: string;
        };

        if (cancelled) return;
        if (payload.ok === false) {
          throw new Error(payload.error || "Could not load request thread");
        }

        setThreadSession(payload.session ?? null);
        setThreadMessages(
          Array.isArray(payload.messages) ? payload.messages : [],
        );
        setThreadError(null);
      } catch (error) {
        if (!cancelled) {
          setThreadError(
            error instanceof Error
              ? error.message
              : "Could not load request thread",
          );
        }
      }
    }

    loadThread();
    return () => {
      cancelled = true;
    };
  }, [request.id]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setLiveNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!executions.some((execution) => execution.status === "running")) {
      return;
    }

    let cancelled = false;

    async function pollLiveState() {
      try {
        const [threadResponse, executionResponse] = await Promise.all([
          fetch(`/admin/change-requests/${request.id}/agent-thread`, {
            cache: "no-store",
          }),
          fetch(`/admin/change-requests/${request.id}/executions`, {
            cache: "no-store",
          }),
        ]);

        if (!threadResponse.ok || !executionResponse.ok || cancelled) {
          return;
        }

        const threadPayload = (await threadResponse.json()) as {
          session?: AgentThreadSession | null;
          messages?: AgentThreadMessage[];
        };
        const executionPayload = (await executionResponse.json()) as {
          executions?: ChangeRequestExecutionRecord[];
        };

        if (cancelled) return;

        setThreadSession(threadPayload.session ?? null);
        setThreadMessages(
          Array.isArray(threadPayload.messages) ? threadPayload.messages : [],
        );
        setExecutions(
          Array.isArray(executionPayload.executions)
            ? executionPayload.executions
            : [],
        );
      } catch {
        // Keep the current panel state and try again on the next interval.
      }
    }

    const intervalId = window.setInterval(pollLiveState, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [executions, request.id]);

  const activeExecution = useMemo(
    () =>
      executions.find((execution) => execution.status === "running") ?? null,
    [executions],
  );
  const activeExecutionElapsed = formatDurationFrom(
    activeExecution?.startedAt ?? null,
    liveNowMs,
  );
  const activeExecutionStage = describeExecutionStage(activeExecution);
  const activeExecutionBranchUrl = executionBranchUrl(activeExecution);
  const activeExecutionDeployUrl = executionDeployUrl(
    activeExecution,
    targetEnvironment,
  );
  const activeExecutionPrUrl = githubCompareUrl(
    targetApp,
    (typeof activeExecution?.meta?.baseBranch === "string"
      ? activeExecution.meta.baseBranch
      : null) ?? configuredBaseBranch,
    activeExecution?.branchName ?? null,
  );
  const reviewExecution = useMemo(
    () => executions.find((execution) => execution.branchName) ?? null,
    [executions],
  );
  const reviewExecutionBranchUrl = executionBranchUrl(reviewExecution);
  const reviewExecutionPrUrl = githubCompareUrl(
    targetApp,
    (typeof reviewExecution?.meta?.baseBranch === "string"
      ? reviewExecution.meta.baseBranch
      : null) ?? configuredBaseBranch,
    reviewExecution?.branchName ?? null,
  );

  useEffect(() => {
    let cancelled = false;

    async function loadExecutions() {
      try {
        const response = await fetch(
          `/admin/change-requests/${request.id}/executions`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error("Could not load execution log");
        }

        const payload = (await response.json()) as {
          ok?: boolean;
          executions?: ChangeRequestExecutionRecord[];
          error?: string;
        };

        if (cancelled) return;
        if (payload.ok === false) {
          throw new Error(payload.error || "Could not load execution log");
        }

        setExecutions(
          Array.isArray(payload.executions) ? payload.executions : [],
        );
      } catch (error) {
        if (!cancelled) {
          setThreadError(
            (current) =>
              current ??
              (error instanceof Error
                ? error.message
                : "Could not load execution log"),
          );
        }
      }
    }

    loadExecutions();
    return () => {
      cancelled = true;
    };
  }, [request.id]);

  async function refreshThread() {
    const response = await fetch(
      `/admin/change-requests/${request.id}/agent-thread`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error("Could not refresh request thread");
    }

    const payload = (await response.json()) as {
      session?: AgentThreadSession | null;
      messages?: AgentThreadMessage[];
    };
    setThreadSession(payload.session ?? null);
    setThreadMessages(Array.isArray(payload.messages) ? payload.messages : []);
  }

  async function refreshExecutions() {
    const response = await fetch(
      `/admin/change-requests/${request.id}/executions`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error("Could not refresh execution log");
    }

    const payload = (await response.json()) as {
      executions?: ChangeRequestExecutionRecord[];
    };
    setExecutions(Array.isArray(payload.executions) ? payload.executions : []);
  }

  async function addRequestComment(content: string) {
    const response = await fetch(
      `/admin/change-requests/${request.id}/comments`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ content }),
      },
    );

    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
      session?: AgentThreadSession | null;
      messages?: AgentThreadMessage[];
    };

    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "Could not add comment");
    }

    setThreadSession(payload.session ?? threadSession);
    setThreadMessages(Array.isArray(payload.messages) ? payload.messages : []);
    return payload.session ?? threadSession;
  }

  async function runAgent(prompt: string, session?: AgentThreadSession | null) {
    const response = await fetch("/admin/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        input: [{ role: "user", content: prompt }],
        session_id: session?.id ?? threadSession?.id ?? null,
        linked_change_request_id: request.id,
        linked_target_environment_id: request.targetEnvironmentId,
        requested_skills: ["change-request-ops", "target-deploy-ops"],
      }),
    });

    const payload = (await response.json()) as {
      error?: string;
      session_id?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error || "Could not continue agent");
    }

    if (payload.session_id) {
      setThreadSession({ id: payload.session_id });
    }
    await refreshThread();
    await refreshExecutions();
  }

  function saveRequestState(nextStatus: string) {
    setStatus(nextStatus);
    setIsDraftDirty(false);
    onSave({ status: nextStatus, triageSummary, agentRecommendation });
  }

  function handleAddComment() {
    const content = commentDraft.trim();
    if (!content) return;

    setThreadError(null);
    startCommentTransition(async () => {
      try {
        await addRequestComment(content);
        setCommentDraft("");
      } catch (error) {
        setThreadError(
          error instanceof Error ? error.message : "Could not add comment",
        );
      }
    });
  }

  function handleContinueAgent() {
    const latestComment =
      [...threadMessages]
        .reverse()
        .find(
          (message) =>
            message.source === "site-comment" && message.content.trim(),
        )
        ?.content.trim() ?? null;

    const prompt = [
      `Continue work on change request #${request.requestNumber}: ${request.title}.`,
      `Current request status: ${request.status}.`,
      latestComment
        ? `Most recent admin comment to follow: ${latestComment}`
        : "No new admin comment was provided; continue from the existing request context and thread history.",
      request.status === "awaiting-review"
        ? "This request is currently in review. Apply the review feedback if needed, continue the work, update the request state if appropriate, and leave a detailed summary comment."
        : "Use the latest request context and comments, continue the work, update the request state if appropriate, and leave a detailed summary comment.",
    ].join("\n");

    setThreadError(null);
    startContinueTransition(async () => {
      try {
        await runAgent(prompt);
      } catch (error) {
        setThreadError(
          error instanceof Error ? error.message : "Could not continue agent",
        );
      }
    });
  }

  function handleCommandTriage() {
    const prompt = [
      `Triage change request #${request.requestNumber}: ${request.title}.`,
      "Review the request context, identify the implementation scope, update the triage summary and suggested changes, and set the request state appropriately when triage is complete.",
    ].join("\n");

    setThreadError(null);
    startCommandTransition(async () => {
      try {
        saveRequestState("triaging");
        await runAgent(prompt);
      } catch (error) {
        setThreadError(
          error instanceof Error ? error.message : "Could not triage request",
        );
      }
    });
  }

  function handleApproveSolution() {
    const prompt = [
      `Implement approved change request #${request.requestNumber}: ${request.title}.`,
      "The proposed solution has been approved. Use the triage summary, suggested changes, request context, and thread history to implement the work. Move the request through Working and leave a summary when it is ready for review.",
    ].join("\n");

    setThreadError(null);
    startCommandTransition(async () => {
      try {
        saveRequestState("in-progress");
        await runAgent(prompt);
      } catch (error) {
        setThreadError(
          error instanceof Error
            ? error.message
            : "Could not start implementation",
        );
      }
    });
  }

  function handleApproveReview() {
    saveRequestState("approved");
  }

  function handleRequestChanges(feedback: string) {
    const content = feedback.trim();
    if (!content) return;

    const prompt = [
      `Review changes were requested for change request #${request.requestNumber}: ${request.title}.`,
      `Review feedback to address: ${content}`,
      "Apply the feedback, update the request state if appropriate, and leave a detailed summary comment when the request is ready for review again.",
    ].join("\n");

    setThreadError(null);
    startCommandTransition(async () => {
      try {
        saveRequestState("changes-requested");
        const session = await addRequestComment(content);
        await runAgent(prompt, session);
      } catch (error) {
        setThreadError(
          error instanceof Error ? error.message : "Could not request changes",
        );
      }
    });
  }

  function handleCloseRequest() {
    saveRequestState("closed");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 p-5 md:p-6">
        <div className="space-y-6">
          <CommandCenter
            status={status}
            triageSummary={triageSummary}
            agentRecommendation={agentRecommendation}
            targetApp={targetApp}
            reviewBranchName={reviewExecution?.branchName ?? null}
            reviewBranchUrl={reviewExecutionBranchUrl}
            reviewCompareUrl={reviewExecutionPrUrl}
            isPending={isPending || isCommandPending}
            onTriage={handleCommandTriage}
            onApproveSolution={handleApproveSolution}
            onApproveReview={handleApproveReview}
            onRequestChanges={handleRequestChanges}
            onCloseRequest={handleCloseRequest}
          />
          <Card className="border-border/60 bg-card/90 rounded-none">
            <CardHeader>
              <CardTitle>Request Details</CardTitle>
              <CardDescription>
                Original request plus the target context currently assigned to
                it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="rounded-none border border-border/70 bg-background/70 p-4 leading-7">
                {request.description}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-none border border-border/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Type
                  </p>
                  <p className="mt-2 font-medium">{request.requestType}</p>
                </div>
                <div className="rounded-none border border-border/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Priority
                  </p>
                  <p className="mt-2 font-medium">{request.priority}</p>
                </div>
                <div className="rounded-none border border-border/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Repository
                  </p>
                  <p className="mt-2 font-medium">
                    {targetApp?.name ?? request.targetAppSlug ?? "Unknown"}
                  </p>
                </div>
                <div className="rounded-none border border-border/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Environment
                  </p>
                  <p className="mt-2 font-medium">
                    {targetEnvironment?.name ?? "Not assigned"}
                  </p>
                </div>
                <div className="rounded-none border border-border/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Target Branch
                  </p>
                  <p className="mt-2 font-medium">
                    {configuredBaseBranch ?? "Not configured"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/90 rounded-none">
            <CardHeader>
              <CardTitle>Triage Notes</CardTitle>
              <CardDescription>
                Capture the proposed scope, suggested changes, and the point
                where the request is ready to route.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="triage-status">Status</Label>
                <Select
                  value={status}
                  onValueChange={(value) => {
                    setStatus(value);
                    setIsDraftDirty(true);
                  }}
                >
                  <SelectTrigger
                    id="triage-status"
                    className="border border-input shadow-sm"
                  >
                    <SelectValue placeholder="Select a status" />
                  </SelectTrigger>
                  <SelectContent>
                    {triageStatuses.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="triage-summary">Triage Summary</Label>
                <Textarea
                  id="triage-summary"
                  value={triageSummary}
                  onChange={(event) => {
                    setTriageSummary(event.target.value);
                    setIsDraftDirty(true);
                  }}
                  placeholder="Summarize what needs to happen, any sequencing, and review notes."
                  className="min-h-32"
                />
              </div>

              <div className="space-y-2">
                <Label
                  className="flex items-center gap-2"
                  htmlFor="agent-recommendation"
                >
                  <Sparkles className="h-4 w-4" />
                  Suggested Changes Summary
                </Label>
                <Textarea
                  id="agent-recommendation"
                  value={agentRecommendation}
                  onChange={(event) => {
                    setAgentRecommendation(event.target.value);
                    setIsDraftDirty(true);
                  }}
                  placeholder="Short summary of the proposed changes shown on the card and used for routing."
                  className="min-h-24"
                />
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-card/90 rounded-none">
            <CardHeader>
              <CardTitle>Request Thread</CardTitle>
              <CardDescription>
                Comments and agent replies linked to this change request.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {activeExecution ? (
                <div className="rounded-none border border-sky-200/70 bg-sky-50/80 p-4 text-sm text-sky-950">
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
                      {activeExecutionElapsed ? (
                        <div>Elapsed: {activeExecutionElapsed}</div>
                      ) : null}
                      {activeExecution.startedAt ? (
                        <div>
                          Started: {isoLabel(activeExecution.startedAt)}
                        </div>
                      ) : null}
                      {configuredBaseBranch ? (
                        <div>Base branch: {configuredBaseBranch}</div>
                      ) : null}
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

              <ScrollArea className="h-[320px] min-h-0 rounded-none border border-border/70 bg-background/70 p-4">
                <div className="space-y-3">
                  {threadMessages.length ? (
                    threadMessages.map((message) => (
                      <div
                        key={message.id}
                        className={`rounded-none px-4 py-3 text-sm leading-6 ${
                          message.role === "assistant"
                            ? "border border-border/70 bg-card text-foreground"
                            : "border border-primary/30 bg-primary/12 text-foreground"
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.16em]">
                          <Badge
                            variant={
                              message.role === "assistant"
                                ? "outline"
                                : "secondary"
                            }
                          >
                            {message.source === "site-comment"
                              ? "comment"
                              : message.role}
                          </Badge>
                          <span
                            className={
                              message.role === "assistant"
                                ? "text-muted-foreground"
                                : "text-foreground/70"
                            }
                          >
                            {isoLabel(message.createdAt) ?? ""}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-none border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                      No comments or agent replies yet for this request.
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="space-y-2">
                <Label htmlFor="request-comment">Add Comment</Label>
                <Textarea
                  id="request-comment"
                  value={commentDraft}
                  onChange={(event) => setCommentDraft(event.target.value)}
                  placeholder="Leave context, a review note, or a clarification without triggering the agent."
                  className="min-h-24"
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleAddComment}
                    disabled={isCommentPending}
                  >
                    {isCommentPending ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : null}
                    {isCommentPending ? "Saving" : "Add comment"}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Continue Agent</Label>
                <p className="text-sm text-muted-foreground">
                  Uses the latest admin comment on this request, plus the
                  current request status and linked thread history.
                </p>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={handleContinueAgent}
                    disabled={isContinuePending}
                  >
                    {isContinuePending ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : null}
                    {isContinuePending ? "Running" : "Continue agent"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/90 rounded-none">
            <CardHeader>
              <CardTitle>Suggested Changes Details</CardTitle>
              <CardDescription>
                Use this scrollable area for fuller triage notes, implementation
                direction, and what Codex should change.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-none border border-border/70 bg-background/70 p-4">
                <Textarea
                  value={agentRecommendation}
                  onChange={(event) => {
                    setAgentRecommendation(event.target.value);
                    setIsDraftDirty(true);
                  }}
                  placeholder="List the proposed edits, areas to touch, expected outcome, and anything the agent should avoid."
                  className="min-h-[420px] max-h-[420px] resize-none overflow-y-auto border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/90 rounded-none">
            <CardHeader>
              <CardTitle>Lifecycle</CardTitle>
              <CardDescription>
                Current timestamps visible to the board.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-none border border-border/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Created
                </p>
                <p className="mt-2">
                  {isoLabel(request.createdAt) ?? "Unknown"}
                </p>
              </div>
              <div className="rounded-none border border-border/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Triaged
                </p>
                <p className="mt-2">
                  {isoLabel(request.triagedAt) ?? "Not yet"}
                </p>
              </div>
              <div className="rounded-none border border-border/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Approved For Work
                </p>
                <p className="mt-2">
                  {isoLabel(request.approvedForWorkAt) ?? "Not yet"}
                </p>
              </div>
              <div className="rounded-none border border-border/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Last Updated
                </p>
                <p className="mt-2">
                  {isoLabel(request.updatedAt) ?? "Unknown"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/90 rounded-none">
            <CardHeader>
              <CardTitle>Execution Log</CardTitle>
              <CardDescription>
                Recent agent runs, status changes, and failure details for this
                request.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[320px]">
                <div className="space-y-3">
                  {executions.length ? (
                    executions.map((execution) => (
                      <div
                        key={execution.id}
                        className="rounded-none border border-border/70 bg-background/70 p-4 text-sm"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={
                                execution.status === "completed"
                                  ? "secondary"
                                  : execution.status === "running"
                                    ? "default"
                                    : "outline"
                              }
                            >
                              {execution.status}
                            </Badge>
                            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                              {execution.actorType}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {isoLabel(execution.updatedAt) ?? ""}
                          </span>
                        </div>
                        {execution.summary ? (
                          <p className="mt-3 whitespace-pre-wrap leading-6">
                            {execution.summary}
                          </p>
                        ) : null}
                        {execution.errorMessage ? (
                          <div className="mt-3 rounded-none border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">
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
                            (typeof execution.meta?.baseBranch === "string"
                              ? execution.meta.baseBranch
                              : null) ?? configuredBaseBranch,
                            execution.branchName,
                          ) ? (
                            <div>
                              PR:{" "}
                              <a
                                href={
                                  githubCompareUrl(
                                    targetApp,
                                    (typeof execution.meta?.baseBranch ===
                                    "string"
                                      ? execution.meta.baseBranch
                                      : null) ?? configuredBaseBranch,
                                    execution.branchName,
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
                          {execution.commitSha ? (
                            <div>Commit: {execution.commitSha}</div>
                          ) : null}
                          {executionDeployUrl(execution, targetEnvironment) ? (
                            <div>
                              Preview:{" "}
                              <a
                                href={
                                  executionDeployUrl(
                                    execution,
                                    targetEnvironment,
                                  ) ?? "#"
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="font-medium underline underline-offset-2"
                              >
                                {executionDeployUrl(
                                  execution,
                                  targetEnvironment,
                                )}
                              </a>
                            </div>
                          ) : null}
                          {execution.startedAt ? (
                            <div>Started: {isoLabel(execution.startedAt)}</div>
                          ) : null}
                          {execution.finishedAt ? (
                            <div>
                              Finished: {isoLabel(execution.finishedAt)}
                            </div>
                          ) : null}
                        </div>
                        {Array.isArray(execution.meta?.runtimeTrace) &&
                        execution.meta.runtimeTrace.length ? (
                          <div className="mt-3 rounded-none border border-border/60 bg-muted/30 p-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                              Execution Trace
                            </div>
                            <div className="mt-2 max-h-40 space-y-2 overflow-y-auto font-mono text-[11px] leading-5 text-muted-foreground">
                              {execution.meta.runtimeTrace.map(
                                (entry, index) => {
                                  if (!entry || typeof entry !== "object") {
                                    return null;
                                  }

                                  const at =
                                    typeof entry.at === "string"
                                      ? entry.at
                                      : null;
                                  const kind =
                                    typeof entry.kind === "string"
                                      ? entry.kind
                                      : "runtime";
                                  const message =
                                    typeof entry.message === "string"
                                      ? entry.message
                                      : "";

                                  if (!message.trim()) {
                                    return null;
                                  }

                                  return (
                                    <div
                                      key={`${execution.id}-trace-${index}`}
                                      className="whitespace-pre-wrap"
                                    >
                                      [{at ?? "unknown"}] {kind}: {message}
                                    </div>
                                  );
                                },
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-none border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                      No execution records yet for this request.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 border-t border-border/70 bg-background/95 px-5 py-4 backdrop-blur md:px-6">
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
              Close
            </Button>
            <Button
              type="button"
              onClick={() =>
                onSave({ status, triageSummary, agentRecommendation })
              }
              disabled={isPending}
            >
              {isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : null}
              {isPending ? "Saving" : "Save request"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
