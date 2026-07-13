export type GatewayCaller = {
  id: "site" | "codex-runtime" | "task-runner";
  kind: "service" | "runtime";
  runtimeKey: string | null;
  token: string;
};

export type GatewayConfig = {
  port: number;
  dbPath: string;
  masterKey: Buffer;
  masterKeyVersion: string;
  previousMasterKeys: Array<{ key: Buffer; keyVersion: string }>;
  callers: GatewayCaller[];
};

export type GatewayConnection = {
  id: string;
  provider: string;
  label: string;
  authType: string;
  status: "untested" | "leased" | "healthy" | "unhealthy" | "revoked";
  capabilityKeys: string[];
  toolsetKeys: string[];
  secretNames: string[];
  lastTestedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GatewayStoredCredential = {
  id: string;
  name: string;
  source: "environment-import" | "admin";
  createdAt: string;
  updatedAt: string;
};

export type GatewayToolsetProfile = {
  key: string;
  connectionId: string;
  protocol: "openapi" | "mcp" | "http" | "adapter";
  discoveryUrl: string;
  auth: ToolsetAuthConfig;
  envBindings: Record<string, string>;
  description: string;
  enabled: boolean;
  lastDiscoveredAt: string | null;
  discoveryError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ToolsetAuthConfig =
  | { type: "none" }
  | { type: "bearer"; secretName: string }
  | { type: "api-key"; secretName: string; headerName: string }
  | { type: "payload-login"; emailSecretName: string; passwordSecretName: string; loginPath: string };

export type GatewayCapability = {
  key: string;
  driverKey: string;
  connectionId: string | null;
  provider: string;
  description: string;
  mode: "read" | "write" | "delivery" | "destructive" | "model" | "runtime";
  riskLevel: "low" | "medium" | "high";
  requiresApproval: boolean;
  enabled: boolean;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  driverConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type HttpJsonReadDriverConfig = {
  baseUrl: string;
  pathTemplate: string;
  method: "GET" | "POST";
  timeoutMs: number;
  maxResponseBytes: number;
  allowedQueryParams: string[];
  allowedJsonBodyParams: string[];
  staticJsonBody: Record<string, unknown>;
  auth:
    | { type: "none" }
    | { type: "bearer"; secretName: string }
    | { type: "api-key"; secretName: string; headerName: string };
};

export type McpToolCallDriverConfig = {
  baseUrl: string;
  pathTemplate: string;
  timeoutMs: number;
  maxResponseBytes: number;
  operations: Record<string, {
    toolName: string;
    allowedArguments: string[];
  }>;
  auth: { type: "bearer"; secretName: string };
};

export type GatewayGrant = {
  id: string;
  subjectType: "runtime" | "service";
  subjectId: string;
  capabilityKey: string;
  allowed: boolean;
  policy: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type GatewayInvocationContext = {
  delegatedActorId?: string;
  requestId?: string;
  workflowRunId?: string;
  workflowStepKey?: string;
  runtimeJobId?: string;
};

export type GatewayAuditEvent = {
  id: string;
  traceId: string;
  capabilityKey: string;
  authenticatedCallerId: string;
  delegatedActorId: string | null;
  requestId: string | null;
  workflowRunId: string | null;
  workflowStepKey: string | null;
  status: "denied" | "succeeded" | "failed";
  policyDecision: string;
  budgetDecision: string | null;
  latencyMs: number | null;
  errorCode: string | null;
  inputSummary: Record<string, unknown> | null;
  outputSummary: Record<string, unknown> | null;
  createdAt: string;
};
