import type {
  ChangeRequestExecutionRecord,
  ChangeRequestRecord,
  TargetAppRecord,
  TargetEnvironmentRecord,
  WorkflowRecord,
} from "@/lib/admin";

export const triageStatuses = [
  { value: "submitted", label: "Inbox" },
  { value: "triaging", label: "Triaging" },
  { value: "ready-for-agent", label: "Ready for agent" },
  { value: "in-progress", label: "Working" },
  { value: "awaiting-review", label: "Awaiting review" },
  { value: "changes-requested", label: "Changes requested" },
  { value: "approved", label: "Approved" },
  { value: "closed", label: "Closed" },
] as const;

export type RequestSortValue =
  | "updated-desc"
  | "updated-asc"
  | "number-desc"
  | "number-asc";

export type AgentThreadMessage = {
  id: string;
  role: string;
  source: string;
  content: string;
  createdAt: string;
};

export type AgentThreadSession = {
  id: string;
};

export type WorkflowStep = {
  key: string;
  label: string;
  type: string;
  statusMap: string[];
  instructionPath: string | null;
};

export const fallbackRequestWorkflowSteps: WorkflowStep[] = [
  {
    key: "triage",
    label: "Triage",
    type: "agent",
    statusMap: ["submitted", "triaging", "needs-human-input"],
    instructionPath: "workflows/change-request-default/steps/triage.md",
  },
  {
    key: "approve-for-work",
    label: "Approve",
    type: "gate",
    statusMap: ["ready-for-agent"],
    instructionPath: null,
  },
  {
    key: "implement",
    label: "Work",
    type: "agent",
    statusMap: ["in-progress", "changes-requested"],
    instructionPath: "workflows/change-request-default/steps/implement.md",
  },
  {
    key: "review",
    label: "Review",
    type: "gate",
    statusMap: ["awaiting-review"],
    instructionPath: "workflows/change-request-default/steps/review.md",
  },
  {
    key: "closed",
    label: "Closed",
    type: "terminal",
    statusMap: ["approved", "rejected", "closed"],
    instructionPath: null,
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function workflowSteps(workflow: WorkflowRecord | null | undefined): WorkflowStep[] {
  const rawSteps = Array.isArray(workflow?.definition?.steps) ? workflow.definition.steps : [];
  const steps = rawSteps
    .filter(isRecord)
    .map((step): WorkflowStep | null => {
      const key = typeof step.key === "string" && step.key.trim() ? step.key.trim() : "";
      if (!key) return null;
      const label =
        typeof step.label === "string" && step.label.trim()
          ? step.label.trim()
          : typeof step.name === "string" && step.name.trim()
            ? step.name.trim()
            : key;
      const type = typeof step.type === "string" && step.type.trim() ? step.type.trim() : "agent";
      const statusMap = Array.isArray(step.statusMap)
        ? step.statusMap.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
      const instructionPath =
        typeof step.instructionPath === "string" && step.instructionPath.trim()
          ? step.instructionPath.trim()
          : null;
      return { key, label, type, statusMap, instructionPath };
    })
    .filter((step): step is WorkflowStep => Boolean(step));

  return steps.length ? steps : fallbackRequestWorkflowSteps;
}

export function workflowStepForStatus(
  status: string,
  steps: WorkflowStep[],
): { step: WorkflowStep; index: number } {
  const index = steps.findIndex((step) => step.statusMap.includes(status));
  if (index >= 0) {
    return { step: steps[index], index };
  }

  const fallbackIndex = steps.findIndex((step) => step.type === "terminal");
  const safeIndex = fallbackIndex >= 0 ? fallbackIndex : Math.max(0, steps.length - 1);
  return { step: steps[safeIndex] ?? fallbackRequestWorkflowSteps[0], index: safeIndex };
}

export function priorityVariant(priority: string) {
  if (priority === "urgent") return "default";
  if (priority === "high") return "secondary";
  return "muted";
}

export function statusLabel(status: string) {
  return (
    triageStatuses.find((option) => option.value === status)?.label ?? status
  );
}

export function statusVariant(status: string) {
  if (status === "in-progress") return "default";
  if (
    status === "ready-for-agent" ||
    status === "awaiting-review" ||
    status === "approved"
  )
    return "secondary";
  if (status === "closed") return "muted";
  return "outline";
}

export function requestTypeLabel(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function parseTimestamp(value: string | null) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function environmentForRequest(
  request: ChangeRequestRecord,
  targetEnvironments: TargetEnvironmentRecord[],
) {
  return (
    targetEnvironments.find(
      (environment) => environment.id === request.targetEnvironmentId,
    ) ?? null
  );
}

export function targetAppForRequest(
  request: ChangeRequestRecord,
  targetApps: TargetAppRecord[],
) {
  return (
    targetApps.find((targetApp) => targetApp.id === request.targetAppId) ?? null
  );
}

export function isoLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function formatDurationFrom(startedAt: string | null, nowMs: number) {
  if (!startedAt) return null;
  const startedMs = new Date(startedAt).getTime();
  if (Number.isNaN(startedMs)) return null;

  const totalSeconds = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function latestTraceEntry(execution: ChangeRequestExecutionRecord | null) {
  const trace = Array.isArray(execution?.meta?.runtimeTrace)
    ? execution.meta.runtimeTrace
    : [];
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const entry = trace[index];
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
      };
    }
  }

  return null;
}

export function describeExecutionStage(
  execution: ChangeRequestExecutionRecord | null,
) {
  if (!execution) {
    return "No active execution";
  }

  const traceEntry = latestTraceEntry(execution);
  if (traceEntry) {
    return `${traceEntry.kind}: ${traceEntry.message}`;
  }

  if (execution.branchName) {
    return `Working on branch ${execution.branchName}`;
  }

  return "Execution started and waiting for runtime updates";
}

export function executionBranchUrl(
  execution: ChangeRequestExecutionRecord | null,
) {
  const candidate = execution?.meta?.branchUrl;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}

export function executionDeployUrl(
  execution: ChangeRequestExecutionRecord | null,
  targetEnvironment?: TargetEnvironmentRecord | null,
) {
  const direct = execution?.deployUrl;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const staticUrl = execution?.meta?.deployStaticUrl;
  if (typeof staticUrl === "string" && staticUrl.trim()) {
    return staticUrl.startsWith("http")
      ? staticUrl.trim()
      : `https://${staticUrl.trim()}`;
  }

  const fallback = targetEnvironment?.baseUrl;
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback.trim();
  }

  return null;
}

export function githubCompareUrl(
  targetApp: TargetAppRecord | null,
  baseBranch: string | null | undefined,
  branchName: string | null | undefined,
) {
  if (!targetApp?.repoUrl || !baseBranch || !branchName) {
    return null;
  }

  const match = targetApp.repoUrl.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/,
  );
  if (!match) {
    return null;
  }

  const [, owner, repo] = match;
  return `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(branchName)}?expand=1`;
}
