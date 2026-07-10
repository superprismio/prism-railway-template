export type HealthResponse = {
  ok: true;
  service: string;
  timestamp: string;
};

export type DiscordChatRequest = {
  prompt: string;
  guildId: string;
  channelId: string;
  threadId?: string | null;
  authorName?: string;
};

export const PRISM_RUNTIME_CONTRACT_VERSION = "2026-07-10" as const;

export type PrismRuntimeJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export type PrismRuntimeDelegationContext = {
  delegatedActorId?: string;
  initiatedBy?: string;
  orgId?: string;
  requestId?: string;
  workflowRunId?: string;
  workflowStepKey?: string;
  taskRunId?: string;
};

export type PrismRuntimeSkillReference = {
  name: string;
  version?: string;
  contentUrl?: string;
};

export type PrismRuntimeCapabilityGrant = {
  key: string;
  grantId?: string;
};

export type PrismRuntimeJobRequest = {
  contractVersion: typeof PRISM_RUNTIME_CONTRACT_VERSION;
  prompt: string;
  sessionId: string;
  continuationId?: string | null;
  recentHistory?: Array<{ role: string; content: string }>;
  skills?: PrismRuntimeSkillReference[];
  capabilities?: PrismRuntimeCapabilityGrant[];
  context?: PrismRuntimeDelegationContext;
  metadata?: Record<string, unknown>;
};

export type PrismRuntimeTraceEvent = {
  at: string;
  kind: string;
  message: string;
};

export type PrismRuntimeArtifactReference = {
  id?: string;
  name: string;
  mediaType?: string;
  url?: string;
};

export type PrismRuntimeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
  currency?: string;
};

export type PrismRuntimeJobResult = {
  responseText: string;
  continuationId?: string | null;
  artifacts?: PrismRuntimeArtifactReference[];
  usage?: PrismRuntimeUsage;
  providerMetadata?: Record<string, unknown>;
};

export type PrismRuntimeJobError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type PrismRuntimeJob = {
  id: string;
  runtimeKey: string;
  adapter: string;
  status: PrismRuntimeJobStatus;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  result?: PrismRuntimeJobResult | null;
  error?: PrismRuntimeJobError | null;
  trace?: PrismRuntimeTraceEvent[];
};

export type PrismRuntimeJobAcceptedResponse = {
  ok: true;
  jobId: string;
  job: PrismRuntimeJob;
};

export type PrismRuntimeJobResponse = {
  ok: boolean;
  job: PrismRuntimeJob;
};

export type PrismRuntimeCapabilities = {
  contractVersion: typeof PRISM_RUNTIME_CONTRACT_VERSION;
  runtimeKey: string;
  adapter: string;
  features: string[];
};

export type PrismGatewayDelegationContext = PrismRuntimeDelegationContext & {
  runtimeJobId?: string;
};

export type PrismGatewayInvokeRequest = {
  capability: string;
  input: Record<string, unknown>;
  context?: PrismGatewayDelegationContext;
  idempotencyKey?: string;
};

export type PrismGatewayUsage = {
  units: number;
  estimatedCost: number;
  actualCost?: number;
  currency?: string;
  budgetStatus: "off" | "within_budget" | "warning" | "blocked";
};

export type PrismGatewayInvokeResponse = {
  ok: boolean;
  traceId: string;
  capability: string;
  result?: unknown;
  usage?: PrismGatewayUsage;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
};

export type PrismGatewayConnectionStatus =
  | "untested"
  | "healthy"
  | "unhealthy"
  | "revoked";

export type PrismGatewayConnectionCreateRequest = {
  provider: string;
  label: string;
  authType: string;
  credentials: Record<string, string>;
};

export type PrismGatewayConnection = {
  id: string;
  provider: string;
  label: string;
  authType: string;
  status: PrismGatewayConnectionStatus;
  capabilityKeys: string[];
  secretNames: string[];
  lastTestedAt?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PrismGatewayCapability = {
  key: string;
  driverKey: string;
  connectionId?: string | null;
  provider: string;
  description: string;
  mode: "read" | "write" | "delivery" | "destructive" | "model" | "runtime";
  riskLevel: "low" | "medium" | "high";
  requiresApproval: boolean;
  enabled: boolean;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  driverConfig: Record<string, unknown>;
};

export type PrismGatewayCapabilityGrant = {
  id: string;
  subjectType: "runtime" | "service" | "agent" | "user" | "role";
  subjectId: string;
  capabilityKey: string;
  allowed: boolean;
  requiresApproval?: boolean;
  allowedDestinations?: string[];
  maxUnitsPerDay?: number;
  createdAt: string;
  updatedAt: string;
};

export type PrismGatewayAuditEvent = {
  id: string;
  traceId: string;
  capabilityKey: string;
  authenticatedCallerId: string;
  delegatedActorId?: string | null;
  requestId?: string | null;
  workflowRunId?: string | null;
  workflowStepKey?: string | null;
  status: "allowed" | "denied" | "succeeded" | "failed";
  policyDecision: string;
  budgetDecision?: string | null;
  latencyMs?: number | null;
  errorCode?: string | null;
  inputSummary?: Record<string, unknown> | null;
  outputSummary?: Record<string, unknown> | null;
  createdAt: string;
};

export type PublicOutputSanitizerRedaction = {
  label: string;
  count: number;
};

export type PublicOutputSanitizerResult = {
  text: string;
  redactions: PublicOutputSanitizerRedaction[];
};

type SanitizerRule = {
  label: string;
  pattern: RegExp;
  replacement: string | ((match: string, ...args: string[]) => string);
};

const sanitizerRules: SanitizerRule[] = [
  {
    label: "railway-private-url",
    pattern: /\bhttps?:\/\/[^\s<>"')\]]*\.railway\.internal(?::\d+)?[^\s<>"')\]]*/gi,
    replacement: "[redacted internal URL]",
  },
  {
    label: "railway-private-host",
    pattern: /\b[a-z0-9-]+\.railway\.internal(?::\d+)?\b/gi,
    replacement: "[redacted internal host]",
  },
  {
    label: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
    replacement: "Bearer [redacted]",
  },
  {
    label: "private-key-block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[redacted private key]",
  },
  {
    label: "secret-assignment",
    pattern: /\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PRIVATE[_-]?KEY)[A-Z0-9_]*\s*[:=]\s*)(["']?)[^\s"',}]{8,}\2/gi,
    replacement: (_match, prefix) => `${prefix}[redacted]`,
  },
  {
    label: "github-token",
    pattern: /\b(?:github_pat_[A-Za-z0-9_]{20,}|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,})\b/g,
    replacement: "[redacted GitHub token]",
  },
  {
    label: "openai-key",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[redacted API key]",
  },
  {
    label: "local-project-path",
    pattern: /(?<![:/\w.-])\/(?:home|Users|workspace|app|data)\/[^\s<>"')\]]{8,}/g,
    replacement: "[redacted local path]",
  },
];

export function sanitizePublicOutput(value: string): PublicOutputSanitizerResult {
  let text = value;
  const redactions: PublicOutputSanitizerRedaction[] = [];

  for (const rule of sanitizerRules) {
    let count = 0;
    text = text.replace(rule.pattern, (match, ...args) => {
      count += 1;
      return typeof rule.replacement === "function"
        ? rule.replacement(match, ...args)
        : rule.replacement;
    });
    if (count > 0) {
      redactions.push({ label: rule.label, count });
    }
  }

  return { text, redactions };
}
