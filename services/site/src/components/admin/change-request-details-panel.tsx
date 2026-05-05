"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  FileText,
  GitBranch,
  ImageIcon,
  LoaderCircle,
  PlayCircle,
  Sparkles,
  X,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type {
  ChangeRequestExecutionRecord,
  ChangeRequestRecord,
  RequestArtifactRecord,
  TargetAppRecord,
  TargetEnvironmentRecord,
  WorkflowEventRecord,
  WorkflowRecord,
} from "@/lib/admin";

import {
  describeExecutionStage,
  executionBranchUrl,
  executionDeployUrl,
  formatDurationFrom,
  githubCompareUrl,
  isoLabel,
  priorityVariant,
  workflowStepForKey,
  workflowSteps,
  type WorkflowStep,
  type AgentThreadMessage,
  type AgentThreadSession,
} from "./change-request-utils";

function CommandCenter({
  status,
  currentWorkflowStepKey,
  steps,
  triageSummary,
  agentRecommendation,
  targetApp,
  reviewBranchName,
  reviewBranchUrl,
  reviewCompareUrl,
  isPending,
  isStepRunning,
  onRunStep,
  onRunUntilGate,
  onApproveSolution,
  onApproveReview,
  onRequestChanges,
  onCloseRequest,
}: {
  status: string;
  currentWorkflowStepKey: string | null;
  steps: WorkflowStep[];
  triageSummary: string;
  agentRecommendation: string;
  targetApp: TargetAppRecord | null;
  reviewBranchName: string | null;
  reviewBranchUrl: string | null;
  reviewCompareUrl: string | null;
  isPending: boolean;
  isStepRunning: boolean;
  onRunStep: () => void;
  onRunUntilGate: () => void;
  onApproveSolution: () => void;
  onApproveReview: () => void;
  onRequestChanges: (comment: string) => void;
  onCloseRequest: () => void;
}) {
  const [reviewComment, setReviewComment] = useState("");
  const currentWorkflowPosition = workflowStepForKey(currentWorkflowStepKey, steps, status);
  const currentStepIndex = currentWorkflowPosition.index;
  const currentStep = currentWorkflowPosition.step;
  const isReviewCommentRequired = status === "awaiting-review";
  const canRequestChanges = reviewComment.trim().length > 0;
  const isRunning = isStepRunning;
  const isTerminal = currentStep.type === "terminal" || ["approved", "rejected", "closed"].includes(status);
  const isReviewGate = currentStep.type === "gate" && status === "awaiting-review";
  const isApprovalGate = currentStep.type === "gate" && status === "ready-for-agent";
  const canRunAgentStep = currentStep.type === "agent" && !isRunning && !isTerminal;

  return (
    <Card className="rounded-none border-border/70 bg-background shadow-none">
      <CardHeader className="space-y-4">
        <div
          className="relative flex flex-col gap-3 md:grid"
          style={{
            gridTemplateColumns:
              steps.length > 1
                ? `repeat(${steps.length}, minmax(0, 1fr))`
                : "minmax(0, 1fr)",
          }}
        >
          <div
            className="absolute top-4 hidden h-px bg-border md:block"
            style={{
              left: `calc(100% / ${steps.length * 2})`,
              right: `calc(100% / ${steps.length * 2})`,
            }}
          />
          <div
            className={`absolute top-4 hidden h-px bg-primary md:block ${
              isRunning ? "animate-pulse" : ""
            }`}
            style={{
              left: `calc(100% / ${steps.length * 2})`,
              width:
                currentStepIndex >= steps.length
                  ? `calc(100% - (100% / ${steps.length}))`
                  : `calc((100% - (100% / ${steps.length})) * ${
                      currentStepIndex / Math.max(1, steps.length - 1)
                    })`,
            }}
          />
          {steps.map((step, index) => {
            const isComplete = status === "closed" || currentStepIndex > index;
            const isCurrent = currentStepIndex === index;
            const isCurrentRunning = isCurrent && isRunning;

            return (
              <div key={step.key} className="relative flex gap-3 md:block">
                {index < steps.length - 1 ? (
                  <div
                    className={`absolute left-4 top-8 h-[calc(100%+0.75rem)] w-px md:hidden ${
                      isComplete ? "bg-primary" : "bg-border"
                    }`}
                  />
                ) : null}
                <div className="relative z-10 h-8 w-8 shrink-0 md:mx-auto">
                  {isCurrentRunning ? (
                    <span className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
                  ) : null}
                  <div
                    className={`relative flex h-8 w-8 items-center justify-center rounded-full border ${
                      isComplete
                        ? "border-primary bg-primary text-primary-foreground"
                        : isCurrentRunning
                          ? "border-primary bg-primary text-primary-foreground shadow-[0_0_0_4px_hsl(var(--primary)/0.18)]"
                          : isCurrent
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-background text-muted-foreground"
                    }`}
                  >
                    {isComplete ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : isCurrentRunning ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : isCurrent ? (
                      <PlayCircle className="h-4 w-4" />
                    ) : (
                      <Circle className="h-3 w-3" />
                    )}
                  </div>
                </div>
                <div className="min-w-0 md:mt-3 md:text-center">
                  <p
                    className={`text-sm font-medium ${
                      isCurrent ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {step.label}
                  </p>
                  <p className="text-xs text-muted-foreground">{step.type}</p>
                </div>
              </div>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{currentStep.label}</p>
              <Badge variant="outline">{currentStep.type}</Badge>
              <Badge variant="outline">{status}</Badge>
            </div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {currentStep.type === "agent" && isRunning
                ? "The agent is running this workflow step."
                : currentStep.type === "agent"
                  ? "This workflow step is ready for an agent run."
                  : currentStep.type === "gate"
                    ? "This workflow step is waiting for a human decision."
                    : currentStep.type === "terminal"
                      ? "This workflow has reached a terminal step."
                      : "This workflow step is active."}
            </p>
            {currentStep.instructionPath ? (
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {currentStep.instructionPath}
              </p>
            ) : null}
          </div>
          {canRunAgentStep ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={onRunStep} disabled={isPending}>
                Run step
              </Button>
              <Button type="button" onClick={onRunUntilGate} disabled={isPending}>
                {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                Run until gate
              </Button>
            </div>
          ) : null}
        </div>

        {isRunning ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <p className="font-medium">Step running</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Prism is working through the current workflow step. The request
                will move to the next mapped status when the run completes.
              </p>
            </div>
          </div>
        ) : null}

        {isApprovalGate ? (
          <div className="space-y-4">
            <div>
              <p className="font-medium">{currentStep.label}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Review the agent output, then approve this gate to continue to
                the next workflow step.
              </p>
            </div>
            <div className="space-y-4">
              <div className="rounded-none border border-border/70 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Workflow Summary
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                  {triageSummary || "No workflow summary yet."}
                </p>
              </div>
              <div className="rounded-none border border-border/70 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Next Step Guidance
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                  {agentRecommendation || "No guidance recorded yet."}
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
                Approve and continue
              </Button>
            </div>
          </div>
        ) : null}

        {isReviewGate ? (
          <div className="space-y-4">
            <div>
              <p className="font-medium">{currentStep.label}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Review the latest execution artifacts. Approve the workflow or
                route feedback back to the agent.
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
                Send back to agent
              </Button>
              <Button
                type="button"
                onClick={onApproveReview}
                disabled={isPending}
              >
                {isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : null}
                Approve workflow
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

        {!canRunAgentStep && !isRunning && !isApprovalGate && !isReviewGate && !["approved", "closed"].includes(status) ? (
          <div>
            <p className="font-medium">{currentStep.label}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              This workflow step has no specialized controls yet.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}

function statusForWorkflowStep(step: WorkflowStep | null | undefined) {
  if (!step?.statusMap.length) return null;
  if (step.type === "agent") {
    return step.statusMap.find((status) => ["triaging", "in-progress"].includes(status)) ?? step.statusMap[0];
  }
  return step.statusMap[0];
}

function artifactPreviewKind(artifact: RequestArtifactRecord) {
  if (artifact.mimeType.startsWith("image/")) return "image";
  if (
    artifact.mimeType.startsWith("text/") ||
    artifact.mimeType.includes("json") ||
    artifact.name.endsWith(".md") ||
    artifact.name.endsWith(".json")
  ) {
    return "text";
  }
  return "raw";
}

function hasAutoContinuedFlag(value: { meta?: Record<string, unknown>; payload?: Record<string, unknown> }) {
  return value.meta?.autoContinued === true || value.payload?.autoContinued === true;
}

export function RequestDetailsPanel({
  request,
  targetApp,
  targetEnvironment,
  workflow,
  isPending,
  error,
  onSave,
}: {
  request: ChangeRequestRecord;
  targetApp: TargetAppRecord | null;
  targetEnvironment: TargetEnvironmentRecord | null;
  workflow: WorkflowRecord | null;
  isPending: boolean;
  error: string | null;
  onSave: (payload: {
    status?: string;
    currentWorkflowStepKey?: string | null;
    triageSummary: string;
    agentRecommendation: string;
  }) => void;
}) {
  const configuredBaseBranch =
    targetEnvironment?.branch ?? targetApp?.defaultBranch ?? null;
  const currentWorkflowSteps = useMemo(() => workflowSteps(workflow), [workflow]);
  const [status, setStatus] = useState(request.status);
  const [currentWorkflowStepKey, setCurrentWorkflowStepKey] = useState(request.currentWorkflowStepKey);
  const currentWorkflowStep = useMemo(
    () => workflowStepForKey(currentWorkflowStepKey, currentWorkflowSteps, status).step,
    [currentWorkflowStepKey, currentWorkflowSteps, status],
  );
  const [triageSummary, setTriageSummary] = useState(
    request.triageSummary ?? "",
  );
  const [agentRecommendation, setAgentRecommendation] = useState(
    request.agentRecommendation ?? "",
  );
  const [manualWorkflowStepKey, setManualWorkflowStepKey] = useState(request.currentWorkflowStepKey ?? "");
  const [manualAgentRecommendation, setManualAgentRecommendation] = useState(
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
  const [workflowEvents, setWorkflowEvents] = useState<WorkflowEventRecord[]>(
    [],
  );
  const [artifacts, setArtifacts] = useState<RequestArtifactRecord[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<RequestArtifactRecord | null>(null);
  const [artifactPreviewText, setArtifactPreviewText] = useState<string | null>(null);
  const [artifactPreviewError, setArtifactPreviewError] = useState<string | null>(null);
  const [isArtifactPreviewLoading, setIsArtifactPreviewLoading] = useState(false);
  const artifactPreviewRequestRef = useRef(0);
  const [isDraftDirty, setIsDraftDirty] = useState(false);
  const [isCommentPending, startCommentTransition] = useTransition();
  const [isContinuePending, startContinueTransition] = useTransition();
  const [isCommandPending, startCommandTransition] = useTransition();
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());

  useEffect(() => {
    setStatus(request.status);
    setCurrentWorkflowStepKey(request.currentWorkflowStepKey);
    setTriageSummary(request.triageSummary ?? "");
    setAgentRecommendation(request.agentRecommendation ?? "");
    setManualWorkflowStepKey(request.currentWorkflowStepKey ?? "");
    setManualAgentRecommendation(request.agentRecommendation ?? "");
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
    const shouldPollLiveState =
      executions.some((execution) => execution.status === "running") ||
      isCommandPending ||
      isContinuePending;

    if (!shouldPollLiveState) {
      return;
    }

    let cancelled = false;

    async function pollLiveState() {
      try {
        const [requestResponse, threadResponse, executionResponse, workflowEventResponse, artifactResponse] = await Promise.all([
          fetch(`/admin/change-requests/${request.id}`, {
            cache: "no-store",
          }),
          fetch(`/admin/change-requests/${request.id}/agent-thread`, {
            cache: "no-store",
          }),
          fetch(`/admin/change-requests/${request.id}/executions`, {
            cache: "no-store",
          }),
          fetch(`/admin/change-requests/${request.id}/workflow-events`, {
            cache: "no-store",
          }),
          fetch(`/admin/change-requests/${request.id}/artifacts`, {
            cache: "no-store",
          }),
        ]);

        if (
          !requestResponse.ok ||
          !threadResponse.ok ||
          !executionResponse.ok ||
          !workflowEventResponse.ok ||
          !artifactResponse.ok ||
          cancelled
        ) {
          return;
        }

        const requestPayload = (await requestResponse.json()) as {
          changeRequest?: ChangeRequestRecord;
        };
        const threadPayload = (await threadResponse.json()) as {
          session?: AgentThreadSession | null;
          messages?: AgentThreadMessage[];
        };
        const executionPayload = (await executionResponse.json()) as {
          executions?: ChangeRequestExecutionRecord[];
        };
        const workflowEventPayload = (await workflowEventResponse.json()) as {
          events?: WorkflowEventRecord[];
        };
        const artifactPayload = (await artifactResponse.json()) as {
          artifacts?: RequestArtifactRecord[];
        };

        if (cancelled) return;

        if (requestPayload.changeRequest) {
          setStatus(requestPayload.changeRequest.status);
          setCurrentWorkflowStepKey(requestPayload.changeRequest.currentWorkflowStepKey);
          setTriageSummary(requestPayload.changeRequest.triageSummary ?? "");
          setAgentRecommendation(requestPayload.changeRequest.agentRecommendation ?? "");
          setManualWorkflowStepKey(requestPayload.changeRequest.currentWorkflowStepKey ?? "");
          setManualAgentRecommendation(requestPayload.changeRequest.agentRecommendation ?? "");
        }
        setThreadSession(threadPayload.session ?? null);
        setThreadMessages(
          Array.isArray(threadPayload.messages) ? threadPayload.messages : [],
        );
        setExecutions(
          Array.isArray(executionPayload.executions)
            ? executionPayload.executions
            : [],
        );
        setWorkflowEvents(
          Array.isArray(workflowEventPayload.events)
            ? workflowEventPayload.events
            : [],
        );
        setArtifacts(
          Array.isArray(artifactPayload.artifacts)
            ? artifactPayload.artifacts
            : [],
        );
      } catch {
        // Keep the current panel state and try again on the next interval.
      }
    }

    pollLiveState();
    const intervalId = window.setInterval(pollLiveState, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [executions, isCommandPending, isContinuePending, request.id]);

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
  const lifecycleEvents = useMemo(
    () =>
      [
        { label: "Last Updated", value: request.updatedAt },
        { label: "Closed", value: request.closedAt },
        { label: "Completed", value: request.completedAt },
        { label: "Approved For Work", value: request.approvedForWorkAt },
        { label: "Triaged", value: request.triagedAt },
        { label: "Created", value: request.createdAt },
      ].sort((left, right) => {
        const leftTime = left.value ? new Date(left.value).getTime() : 0;
        const rightTime = right.value ? new Date(right.value).getTime() : 0;
        return (
          (Number.isNaN(rightTime) ? 0 : rightTime) -
          (Number.isNaN(leftTime) ? 0 : leftTime)
        );
      }),
    [
      request.approvedForWorkAt,
      request.closedAt,
      request.completedAt,
      request.createdAt,
      request.triagedAt,
      request.updatedAt,
    ],
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

  useEffect(() => {
    let cancelled = false;

    async function loadWorkflowEvents() {
      try {
        const response = await fetch(
          `/admin/change-requests/${request.id}/workflow-events`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error("Could not load workflow events");
        }

        const payload = (await response.json()) as {
          ok?: boolean;
          events?: WorkflowEventRecord[];
          error?: string;
        };

        if (cancelled) return;
        if (payload.ok === false) {
          throw new Error(payload.error || "Could not load workflow events");
        }

        setWorkflowEvents(Array.isArray(payload.events) ? payload.events : []);
      } catch (error) {
        if (!cancelled) {
          setThreadError(
            (current) =>
              current ??
              (error instanceof Error
                ? error.message
                : "Could not load workflow events"),
          );
        }
      }
    }

    loadWorkflowEvents();
    return () => {
      cancelled = true;
    };
  }, [request.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadArtifacts() {
      try {
        const response = await fetch(
          `/admin/change-requests/${request.id}/artifacts`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error("Could not load request artifacts");
        }

        const payload = (await response.json()) as {
          ok?: boolean;
          artifacts?: RequestArtifactRecord[];
          error?: string;
        };

        if (cancelled) return;
        if (payload.ok === false) {
          throw new Error(payload.error || "Could not load request artifacts");
        }

        setArtifacts(Array.isArray(payload.artifacts) ? payload.artifacts : []);
      } catch (error) {
        if (!cancelled) {
          setThreadError(
            (current) =>
              current ??
              (error instanceof Error
                ? error.message
                : "Could not load request artifacts"),
          );
        }
      }
    }

    loadArtifacts();
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

  async function refreshWorkflowEvents() {
    const response = await fetch(
      `/admin/change-requests/${request.id}/workflow-events`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error("Could not refresh workflow events");
    }

    const payload = (await response.json()) as {
      events?: WorkflowEventRecord[];
    };
    setWorkflowEvents(Array.isArray(payload.events) ? payload.events : []);
  }

  async function refreshArtifacts() {
    const response = await fetch(
      `/admin/change-requests/${request.id}/artifacts`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error("Could not refresh request artifacts");
    }

    const payload = (await response.json()) as {
      artifacts?: RequestArtifactRecord[];
    };
    setArtifacts(Array.isArray(payload.artifacts) ? payload.artifacts : []);
  }

  async function openArtifactPreview(artifact: RequestArtifactRecord) {
    const requestToken = artifactPreviewRequestRef.current + 1;
    artifactPreviewRequestRef.current = requestToken;
    setSelectedArtifact(artifact);
    setArtifactPreviewText(null);
    setArtifactPreviewError(null);
    const kind = artifactPreviewKind(artifact);
    if (kind !== "text") {
      setIsArtifactPreviewLoading(false);
      return;
    }

    setIsArtifactPreviewLoading(true);
    try {
      const response = await fetch(
        `/admin/change-requests/${request.id}/artifacts/${artifact.id}/content`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error("Could not load artifact preview");
      }
      const text = await response.text();
      if (artifactPreviewRequestRef.current !== requestToken) return;
      setArtifactPreviewText(text);
    } catch (error) {
      if (artifactPreviewRequestRef.current !== requestToken) return;
      setArtifactPreviewError(
        error instanceof Error ? error.message : "Could not load artifact preview",
      );
    } finally {
      if (artifactPreviewRequestRef.current === requestToken) {
        setIsArtifactPreviewLoading(false);
      }
    }
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

  async function runAgent(
    prompt: string,
    session?: AgentThreadSession | null,
    workflowAction?: string,
    autoContinueUntilGate = false,
  ) {
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
        workflow_action: workflowAction ?? null,
        auto_continue_until_gate: autoContinueUntilGate,
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
    await refreshWorkflowEvents();
    await refreshArtifacts();
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
      `Continue workflow step ${currentWorkflowStep.key} for request #${request.requestNumber}: ${request.title}.`,
      `Current request status: ${request.status}.`,
      `Workflow step label: ${currentWorkflowStep.label}.`,
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

  function handleCommandTriage(autoContinueUntilGate = false) {
    const prompt = [
      `Run workflow step ${currentWorkflowStep.key} for request #${request.requestNumber}: ${request.title}.`,
      `Step label: ${currentWorkflowStep.label}.`,
      currentWorkflowStep.instructionPath
        ? `Use the workflow step instructions at ${currentWorkflowStep.instructionPath}.`
        : "Use the current workflow step instructions from runtime metadata.",
      "Use the request context and thread history. Return a concise summary of what changed or what should happen next.",
    ].join("\n");

    setThreadError(null);
    const previousStatus = status;
    startCommandTransition(async () => {
      try {
        setStatus("triaging");
        await runAgent(prompt, null, undefined, autoContinueUntilGate);
      } catch (error) {
        setStatus(previousStatus);
        setThreadError(
          error instanceof Error ? error.message : "Could not triage request",
        );
      }
    });
  }

  function handleApproveSolution() {
    const prompt = [
      `Approve current gate and continue workflow for request #${request.requestNumber}: ${request.title}.`,
      "Use the workflow manifest to route to the next agent step. Use the workflow summary, next-step guidance, request context, and thread history.",
    ].join("\n");

    setThreadError(null);
    const previousStatus = status;
    startCommandTransition(async () => {
      try {
        setStatus("in-progress");
        await runAgent(prompt, null, "approved", true);
      } catch (error) {
        setStatus(previousStatus);
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
      `Route review feedback back to the workflow agent for request #${request.requestNumber}: ${request.title}.`,
      `Review feedback to address: ${content}`,
      "Use the workflow manifest to return to the appropriate agent step. Apply the feedback and leave a detailed summary when the request is ready for review again.",
    ].join("\n");

    setThreadError(null);
    const previousStatus = status;
    startCommandTransition(async () => {
      try {
        setStatus("changes-requested");
        const session = await addRequestComment(content);
        await runAgent(prompt, session, "changesRequested", true);
      } catch (error) {
        setStatus(previousStatus);
        setThreadError(
          error instanceof Error ? error.message : "Could not request changes",
        );
      }
    });
  }

  function handleCloseRequest() {
    saveRequestState("closed");
  }

  function handleSaveManualStatus() {
    const nextStep = currentWorkflowSteps.find((step) => step.key === manualWorkflowStepKey);
    const nextStatus = statusForWorkflowStep(nextStep) ?? status;
    setStatus(nextStatus);
    setCurrentWorkflowStepKey(manualWorkflowStepKey || null);
    setIsDraftDirty(false);
    onSave({
      currentWorkflowStepKey: manualWorkflowStepKey || null,
      triageSummary,
      agentRecommendation,
    });
  }

  function handleManualWorkflowStepChange(nextStepKey: string) {
    setManualWorkflowStepKey(nextStepKey);
  }

  function handleSaveSuggestedChanges() {
    setAgentRecommendation(manualAgentRecommendation);
    setIsDraftDirty(false);
    onSave({
      status,
      triageSummary,
      agentRecommendation: manualAgentRecommendation,
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 p-5 md:p-6">
        <div className="space-y-6">
          <CommandCenter
            status={status}
            currentWorkflowStepKey={currentWorkflowStepKey}
            steps={currentWorkflowSteps}
            triageSummary={triageSummary}
            agentRecommendation={agentRecommendation}
            targetApp={targetApp}
            reviewBranchName={reviewExecution?.branchName ?? null}
            reviewBranchUrl={reviewExecutionBranchUrl}
            reviewCompareUrl={reviewExecutionPrUrl}
            isPending={isPending || isCommandPending}
            isStepRunning={Boolean(activeExecution)}
            onRunStep={() => handleCommandTriage(false)}
            onRunUntilGate={() => handleCommandTriage(true)}
            onApproveSolution={handleApproveSolution}
            onApproveReview={handleApproveReview}
            onRequestChanges={handleRequestChanges}
            onCloseRequest={handleCloseRequest}
          />
          {error || threadError ? (
            <div className="rounded-none border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error ?? threadError}
            </div>
          ) : isDraftDirty ? (
            <div className="rounded-none border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              Unsaved changes
            </div>
          ) : null}
          <Tabs defaultValue="details" className="space-y-4">
            <TabsList className="h-auto flex-wrap rounded-none bg-muted/50 p-1">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
              <TabsTrigger value="comments">Comments</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="log">Log</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="mt-0 space-y-4">
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
              <CardTitle>Workflow Notes</CardTitle>
              <CardDescription>
                Step summaries, guidance, and routing context for this workflow.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {triageSummary || agentRecommendation ? (
                <>
                  {triageSummary ? (
                    <div className="rounded-none border border-border/70 p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        Workflow Summary
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                        {triageSummary}
                      </p>
                    </div>
                  ) : null}
                  {agentRecommendation ? (
                    <div className="rounded-none border border-border/70 p-4">
                      <p className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        <Sparkles className="h-4 w-4" />
                        Next Step Guidance
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                        {agentRecommendation}
                      </p>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="rounded-none border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  No workflow notes yet.
                </div>
              )}
            </CardContent>
          </Card>
            </TabsContent>

            <TabsContent value="artifacts" className="mt-0">
              <Card className="border-border/60 bg-card/90 rounded-none">
                <CardHeader>
                  <CardTitle>Artifacts</CardTitle>
                  <CardDescription>
                    Durable files produced by workflow steps for this request.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {artifacts.length ? (
                    artifacts.map((artifact) => {
                      const href = `/admin/change-requests/${request.id}/artifacts/${artifact.id}/content`;
                      const isImage = artifact.mimeType.startsWith("image/");

                      return (
                        <div
                          key={artifact.id}
                          className="rounded-none border border-border/70 bg-background/70 p-4 text-sm"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                {isImage ? (
                                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <FileText className="h-4 w-4 text-muted-foreground" />
                                )}
                                <button
                                  type="button"
                                  onClick={() => openArtifactPreview(artifact)}
                                  className="break-all font-medium underline underline-offset-2"
                                >
                                  {artifact.name}
                                </button>
                                <Badge variant="outline">{artifact.kind}</Badge>
                              </div>
                              {artifact.description ? (
                                <p className="mt-2 whitespace-pre-wrap leading-6 text-muted-foreground">
                                  {artifact.description}
                                </p>
                              ) : null}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {isoLabel(artifact.createdAt) ?? ""}
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span>{artifact.mimeType}</span>
                            <span>{formatBytes(artifact.sizeBytes)}</span>
                            <span>by {artifact.createdBy}</span>
                          </div>
                          {Object.keys(artifact.metadata).length ? (
                            <pre className="mt-3 max-h-40 overflow-auto rounded-none border border-border/60 bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                              {JSON.stringify(artifact.metadata, null, 2)}
                            </pre>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openArtifactPreview(artifact)}
                            >
                              View
                            </Button>
                            <Button type="button" variant="ghost" size="sm" asChild>
                              <a href={href} target="_blank" rel="noreferrer">
                                <ExternalLink className="h-4 w-4" />
                                Raw
                              </a>
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-none border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                      No artifacts have been saved for this request yet.
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="comments" className="mt-0">
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

            </CardContent>
          </Card>
            </TabsContent>

            <TabsContent value="advanced" className="mt-0">
              <Card className="border-border/60 bg-card/90 rounded-none">
            <CardHeader>
              <CardTitle>Advanced</CardTitle>
              <CardDescription>
                Manual workflow step and guidance updates.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label htmlFor="manual-workflow-step">Workflow Step</Label>
                <div className="flex flex-wrap items-center gap-3">
                  <Select value={manualWorkflowStepKey} onValueChange={handleManualWorkflowStepChange}>
                    <SelectTrigger
                      id="manual-workflow-step"
                      className="w-full border border-input shadow-sm sm:w-[360px]"
                    >
                      <SelectValue placeholder="Select workflow step" />
                    </SelectTrigger>
                    <SelectContent>
                      {currentWorkflowSteps.map((step) => (
                        <SelectItem key={step.key} value={step.key}>
                          {step.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="icon"
                    onClick={handleSaveManualStatus}
                    disabled={
                      isPending ||
                      (manualWorkflowStepKey || null) === currentWorkflowStepKey
                    }
                    aria-label="Save workflow step"
                    title="Save workflow step"
                  >
                    {isPending ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-2 rounded-none border border-border/70 p-4">
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

              {agentRecommendation || manualAgentRecommendation ? (
                <div className="space-y-3">
                  <Label
                    className="flex items-center gap-2"
                    htmlFor="manual-agent-recommendation"
                  >
                    <Sparkles className="h-4 w-4" />
                    Next Step Guidance
                  </Label>
                  <div className="rounded-none border border-border/70 bg-background/70 p-4">
                    <Textarea
                      id="manual-agent-recommendation"
                      value={manualAgentRecommendation}
                      onChange={(event) =>
                        setManualAgentRecommendation(event.target.value)
                      }
                      placeholder="List the proposed edits, areas to touch, expected outcome, and anything the agent should avoid."
                      className="min-h-[420px] max-h-[420px] resize-none overflow-y-auto border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0"
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      onClick={handleSaveSuggestedChanges}
                      disabled={
                        isPending ||
                        manualAgentRecommendation === agentRecommendation
                      }
                    >
                      {isPending ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : null}
                      Save guidance
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
            </TabsContent>

            <TabsContent value="history" className="mt-0">
              <Card className="border-border/60 bg-card/90 rounded-none">
            <CardHeader>
              <CardTitle>History</CardTitle>
              <CardDescription>
                Workflow events and lifecycle timestamps.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Workflow Events
                </p>
                {workflowEvents.length ? (
                  workflowEvents.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-none border border-border/70 bg-background/70 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{event.eventType}</Badge>
                          {event.stepKey ? (
                            <Badge variant="secondary">{event.stepKey}</Badge>
                          ) : null}
                          {hasAutoContinuedFlag(event) ? (
                            <Badge variant="outline">auto</Badge>
                          ) : null}
                          <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                            {event.actorType}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {isoLabel(event.createdAt) ?? ""}
                        </span>
                      </div>
                      {event.note ? (
                        <p className="mt-3 whitespace-pre-wrap leading-6">
                          {event.note}
                        </p>
                      ) : null}
                      {Object.keys(event.payload).length ? (
                        <pre className="mt-3 max-h-40 overflow-auto rounded-none border border-border/60 bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                          {JSON.stringify(event.payload, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-none border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                    No workflow events recorded yet.
                  </div>
                )}
              </div>

              <div className="space-y-3 pt-3">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Lifecycle
                </p>
              {lifecycleEvents.map((event) => (
                <div
                  key={event.label}
                  className="rounded-none border border-border/70 p-4"
                >
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {event.label}
                  </p>
                  <p className="mt-2">{isoLabel(event.value) ?? "Not yet"}</p>
                </div>
              ))}
              </div>
            </CardContent>
          </Card>
            </TabsContent>

            <TabsContent value="log" className="mt-0">
              <Card className="border-border/60 bg-card/90 rounded-none">
            <CardHeader>
              <CardTitle>Execution Log</CardTitle>
              <CardDescription>
                Recent agent runs, status changes, and failure details for this
                request.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[420px] max-h-[calc(100vh-430px)] min-h-[240px]">
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
                            {hasAutoContinuedFlag(execution) ? (
                              <Badge variant="outline">auto</Badge>
                            ) : null}
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
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Dialog
        open={Boolean(selectedArtifact)}
        onOpenChange={(open) => {
          if (!open) {
            artifactPreviewRequestRef.current += 1;
            setSelectedArtifact(null);
            setArtifactPreviewText(null);
            setArtifactPreviewError(null);
            setIsArtifactPreviewLoading(false);
          }
        }}
      >
        <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="min-w-0 pr-8">
              <span className="truncate">{selectedArtifact?.name ?? "Artifact"}</span>
            </DialogTitle>
          </DialogHeader>
          {selectedArtifact ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <div className="flex flex-wrap gap-3">
                  <span>{selectedArtifact.mimeType}</span>
                  <span>{formatBytes(selectedArtifact.sizeBytes)}</span>
                  <span>{selectedArtifact.kind}</span>
                </div>
                <Button type="button" variant="outline" size="sm" asChild>
                  <a
                    href={`/admin/change-requests/${request.id}/artifacts/${selectedArtifact.id}/content`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Raw
                  </a>
                </Button>
              </div>
              {artifactPreviewError ? (
                <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {artifactPreviewError}
                </div>
              ) : null}
              {artifactPreviewKind(selectedArtifact) === "image" ? (
                <ScrollArea className="h-[calc(90vh-180px)] border border-border/70 bg-muted/20">
                  <div className="flex min-h-[320px] items-center justify-center p-4">
                    <img
                      src={`/admin/change-requests/${request.id}/artifacts/${selectedArtifact.id}/content`}
                      alt={selectedArtifact.name}
                      className="max-h-[calc(90vh-220px)] max-w-full object-contain"
                    />
                  </div>
                </ScrollArea>
              ) : artifactPreviewKind(selectedArtifact) === "text" ? (
                <ScrollArea className="h-[calc(90vh-180px)] border border-border/70 bg-muted/20">
                  {isArtifactPreviewLoading ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Loading preview...
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap break-words p-4 text-sm leading-6">
                      {artifactPreviewText ?? ""}
                    </pre>
                  )}
                </ScrollArea>
              ) : (
                <div className="border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  No inline preview is available for this artifact type. Open the raw file instead.
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
