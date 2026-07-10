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
  callers: GatewayCaller[];
};

export type GatewayConnection = {
  id: string;
  provider: string;
  label: string;
  authType: string;
  status: "untested" | "healthy" | "unhealthy" | "revoked";
  capabilityKeys: string[];
  secretNames: string[];
  lastTestedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

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
  timeoutMs: number;
  maxResponseBytes: number;
};
