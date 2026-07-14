import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "./crypto.js";
import { isForbiddenHostname } from "./network.js";
import type {
  GatewayCapability,
  GatewayConnection,
  GatewayStoredCredential,
  GatewayAuditEvent,
  GatewayCaller,
  GatewayGrant,
  GatewayInvocationContext,
  GatewayToolsetProfile,
  HttpJsonReadDriverConfig,
  McpToolCallDriverConfig,
  ToolsetAuthConfig,
} from "./types.js";

export class GatewayStoreError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

type ConnectionRow = {
  id: string;
  credential_key: string | null;
  provider: string;
  label: string;
  auth_type: string;
  configuration_json: string;
  env_bindings_json: string;
  status: GatewayConnection["status"];
  last_tested_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

type CapabilityRow = {
  key: string;
  driver_key: string;
  connection_id: string | null;
  provider: string;
  description: string;
  mode: GatewayCapability["mode"];
  risk_level: GatewayCapability["riskLevel"];
  requires_approval: number;
  enabled: number;
  input_schema_json: string | null;
  output_schema_json: string | null;
  driver_config_json: string;
  created_at: string;
  updated_at: string;
};

type ToolsetProfileRow = {
  key: string;
  connection_id: string;
  protocol: GatewayToolsetProfile["protocol"];
  discovery_url: string;
  auth_config_json: string;
  env_bindings_json: string;
  description: string;
  enabled: number;
  last_discovered_at: string | null;
  discovery_error: string | null;
  created_at: string;
  updated_at: string;
};

type SecretRow = EncryptedSecret & {
  id?: string;
  connection_id?: string;
  secret_name: string;
};

type StoredCredentialRow = EncryptedSecret & {
  id: string;
  name: string;
  source: GatewayStoredCredential["source"];
  created_at: string;
  updated_at: string;
};

type GrantRow = {
  id: string;
  subject_type: GatewayGrant["subjectType"];
  subject_id: string;
  capability_key: string;
  allowed: number;
  policy_json: string;
  created_at: string;
  updated_at: string;
};

type AuditRow = {
  id: string;
  trace_id: string;
  capability_key: string;
  authenticated_caller_id: string;
  delegated_actor_id: string | null;
  request_id: string | null;
  workflow_run_id: string | null;
  workflow_step_key: string | null;
  status: GatewayAuditEvent["status"];
  policy_decision: string;
  budget_decision: string | null;
  latency_ms: number | null;
  error_code: string | null;
  input_summary_json: string | null;
  output_summary_json: string | null;
  created_at: string;
};

function parseJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  return JSON.parse(value) as Record<string, unknown>;
}

function stringRecord(value: string | null): Record<string, string> {
  const parsed = parseJson(value);
  if (!parsed) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function credentialKey(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return normalized.length >= 2 ? normalized : "credential";
}

function environmentPrefix(value: string) {
  return value
    .replace(/\.admin$|\.read$|\.write$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function secretEnvironmentSuffix(value: string) {
  const normalized = environmentPrefix(value);
  if (normalized === "APIKEY" || normalized === "API_KEY") return "API_KEY";
  if (normalized === "ACCESSTOKEN" || normalized === "ACCESS_TOKEN") return "ACCESS_TOKEN";
  if (normalized === "SECRETCREDENTIAL" || normalized === "SECRET_CREDENTIAL") return "SECRET";
  return normalized || "SECRET";
}

function validateCredentialConfiguration(input: Record<string, string>) {
  if (Object.keys(input).length > 50) throw new GatewayStoreError("CREDENTIAL_CONFIGURATION_INVALID", 400);
  for (const [name, value] of Object.entries(input)) {
    if (!/^[A-Z_][A-Z0-9_]{0,119}$/.test(name) || !value || value.length > 10_000) {
      throw new GatewayStoreError("CREDENTIAL_CONFIGURATION_INVALID", 400);
    }
  }
}

function validateCredentialEnvBindings(input: Record<string, string>) {
  if (Object.keys(input).length > 50) throw new GatewayStoreError("CREDENTIAL_ENV_BINDINGS_INVALID", 400);
  for (const [envName, secretName] of Object.entries(input)) {
    if (
      !/^[A-Z_][A-Z0-9_]{0,119}$/.test(envName)
      || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(secretName)
    ) {
      throw new GatewayStoreError("CREDENTIAL_ENV_BINDINGS_INVALID", 400);
    }
  }
}

export function validatePublicHttpsBaseUrl(value: unknown) {
  if (typeof value !== "string") throw new GatewayStoreError("CAPABILITY_BASE_URL_REQUIRED", 400);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GatewayStoreError("CAPABILITY_BASE_URL_INVALID", 400);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new GatewayStoreError("CAPABILITY_BASE_URL_MUST_BE_PUBLIC_HTTPS_ORIGIN", 400);
  }
  if (isForbiddenHostname(url.hostname)) {
    throw new GatewayStoreError("CAPABILITY_BASE_URL_PRIVATE_HOST_FORBIDDEN", 400);
  }
  return url.origin;
}

export function validatePublicHttpsUrl(value: unknown, field = "URL") {
  if (typeof value !== "string") throw new GatewayStoreError(`${field}_REQUIRED`, 400);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GatewayStoreError(`${field}_INVALID`, 400);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new GatewayStoreError(`${field}_MUST_BE_PUBLIC_HTTPS`, 400);
  }
  if (isForbiddenHostname(url.hostname)) {
    throw new GatewayStoreError(`${field}_PRIVATE_HOST_FORBIDDEN`, 400);
  }
  return url.toString();
}

export function normalizeMcpToolCallConfig(value: unknown): McpToolCallDriverConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GatewayStoreError("CAPABILITY_DRIVER_CONFIG_REQUIRED", 400);
  }
  const input = value as Record<string, unknown>;
  const baseUrl = validatePublicHttpsBaseUrl(input.baseUrl);
  const pathTemplate = typeof input.pathTemplate === "string" ? input.pathTemplate.trim() : "";
  if (!pathTemplate.startsWith("/") || pathTemplate.includes("://") || pathTemplate.includes("..")) {
    throw new GatewayStoreError("CAPABILITY_PATH_TEMPLATE_INVALID", 400);
  }
  const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : 10_000;
  const maxResponseBytes = typeof input.maxResponseBytes === "number" ? input.maxResponseBytes : 1_000_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new GatewayStoreError("CAPABILITY_TIMEOUT_INVALID", 400);
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1_024 || maxResponseBytes > 5_000_000) {
    throw new GatewayStoreError("CAPABILITY_RESPONSE_LIMIT_INVALID", 400);
  }
  if (!input.operations || typeof input.operations !== "object" || Array.isArray(input.operations)) {
    throw new GatewayStoreError("CAPABILITY_MCP_OPERATIONS_REQUIRED", 400);
  }
  const operationEntries = Object.entries(input.operations as Record<string, unknown>);
  if (operationEntries.length === 0 || operationEntries.length > 20) {
    throw new GatewayStoreError("CAPABILITY_MCP_OPERATIONS_INVALID", 400);
  }
  const operations: McpToolCallDriverConfig["operations"] = {};
  for (const [operation, rawConfig] of operationEntries) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(operation) || !rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
      throw new GatewayStoreError("CAPABILITY_MCP_OPERATION_INVALID", 400);
    }
    const operationConfig = rawConfig as Record<string, unknown>;
    const toolName = typeof operationConfig.toolName === "string" ? operationConfig.toolName.trim() : "";
    const allowedArguments = Array.isArray(operationConfig.allowedArguments)
      ? operationConfig.allowedArguments.map((entry) => typeof entry === "string" ? entry.trim() : "")
      : [];
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/.test(toolName)) {
      throw new GatewayStoreError("CAPABILITY_MCP_TOOL_NAME_INVALID", 400);
    }
    if (
      allowedArguments.some((entry) => !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(entry))
      || new Set(allowedArguments).size !== allowedArguments.length
    ) {
      throw new GatewayStoreError("CAPABILITY_MCP_ARGUMENT_ALLOWLIST_INVALID", 400);
    }
    operations[operation] = { toolName, allowedArguments };
  }
  const authInput = input.auth;
  if (!authInput || typeof authInput !== "object" || Array.isArray(authInput)) {
    throw new GatewayStoreError("CAPABILITY_AUTH_CONFIG_INVALID", 400);
  }
  const authRecord = authInput as Record<string, unknown>;
  const secretName = typeof authRecord.secretName === "string" ? authRecord.secretName.trim() : "";
  if (authRecord.type !== "bearer" || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(secretName)) {
    throw new GatewayStoreError("CAPABILITY_AUTH_CONFIG_INVALID", 400);
  }
  return {
    baseUrl,
    pathTemplate,
    timeoutMs,
    maxResponseBytes,
    operations,
    auth: { type: "bearer", secretName },
  };
}

export function normalizeHttpJsonReadConfig(value: unknown): HttpJsonReadDriverConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GatewayStoreError("CAPABILITY_DRIVER_CONFIG_REQUIRED", 400);
  }
  const input = value as Record<string, unknown>;
  const baseUrl = validatePublicHttpsBaseUrl(input.baseUrl);
  const pathTemplate = typeof input.pathTemplate === "string" ? input.pathTemplate.trim() : "";
  if (!pathTemplate.startsWith("/") || pathTemplate.includes("://") || pathTemplate.includes("..")) {
    throw new GatewayStoreError("CAPABILITY_PATH_TEMPLATE_INVALID", 400);
  }
  const method = input.method === undefined || input.method === "GET"
    ? "GET"
    : input.method === "POST"
      ? "POST"
      : null;
  if (!method) throw new GatewayStoreError("CAPABILITY_HTTP_METHOD_INVALID", 400);
  const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : 10_000;
  const maxResponseBytes = typeof input.maxResponseBytes === "number" ? input.maxResponseBytes : 1_000_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new GatewayStoreError("CAPABILITY_TIMEOUT_INVALID", 400);
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1_024 || maxResponseBytes > 5_000_000) {
    throw new GatewayStoreError("CAPABILITY_RESPONSE_LIMIT_INVALID", 400);
  }
  const allowedQueryParams = Array.isArray(input.allowedQueryParams)
    ? input.allowedQueryParams.map((entry) => typeof entry === "string" ? entry.trim() : "")
    : [];
  if (
    allowedQueryParams.some((entry) => !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(entry))
    || new Set(allowedQueryParams).size !== allowedQueryParams.length
  ) {
    throw new GatewayStoreError("CAPABILITY_QUERY_ALLOWLIST_INVALID", 400);
  }
  const allowedJsonBodyParams = Array.isArray(input.allowedJsonBodyParams)
    ? input.allowedJsonBodyParams.map((entry) => typeof entry === "string" ? entry.trim() : "")
    : [];
  if (
    allowedJsonBodyParams.some((entry) => !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(entry))
    || new Set(allowedJsonBodyParams).size !== allowedJsonBodyParams.length
  ) {
    throw new GatewayStoreError("CAPABILITY_JSON_BODY_ALLOWLIST_INVALID", 400);
  }
  const staticJsonBody = input.staticJsonBody === undefined ? {} : input.staticJsonBody;
  if (!staticJsonBody || typeof staticJsonBody !== "object" || Array.isArray(staticJsonBody)) {
    throw new GatewayStoreError("CAPABILITY_STATIC_JSON_BODY_INVALID", 400);
  }
  const staticJsonBodyRecord = staticJsonBody as Record<string, unknown>;
  const staticBodyKeys = Object.keys(staticJsonBodyRecord);
  if (staticBodyKeys.some((entry) => !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(entry))) {
    throw new GatewayStoreError("CAPABILITY_STATIC_JSON_BODY_INVALID", 400);
  }
  if (method === "GET" && (allowedJsonBodyParams.length > 0 || staticBodyKeys.length > 0)) {
    throw new GatewayStoreError("CAPABILITY_GET_BODY_FORBIDDEN", 400);
  }
  if (method === "POST" && allowedQueryParams.length > 0) {
    throw new GatewayStoreError("CAPABILITY_POST_QUERY_FORBIDDEN", 400);
  }
  if (allowedJsonBodyParams.some((entry) => staticBodyKeys.includes(entry))) {
    throw new GatewayStoreError("CAPABILITY_STATIC_JSON_BODY_OVERRIDE_FORBIDDEN", 400);
  }
  let staticBodyBytes = 0;
  try {
    staticBodyBytes = Buffer.byteLength(JSON.stringify(staticJsonBodyRecord));
  } catch {
    throw new GatewayStoreError("CAPABILITY_STATIC_JSON_BODY_INVALID", 400);
  }
  if (staticBodyBytes > 65_536) {
    throw new GatewayStoreError("CAPABILITY_STATIC_JSON_BODY_TOO_LARGE", 400);
  }
  const authInput = input.auth;
  let auth: HttpJsonReadDriverConfig["auth"] = { type: "none" };
  if (authInput !== undefined) {
    if (!authInput || typeof authInput !== "object" || Array.isArray(authInput)) {
      throw new GatewayStoreError("CAPABILITY_AUTH_CONFIG_INVALID", 400);
    }
    const candidate = authInput as Record<string, unknown>;
    const secretName = typeof candidate.secretName === "string" ? candidate.secretName.trim() : "";
    if (candidate.type === "bearer" && /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(secretName)) {
      auth = { type: "bearer", secretName };
    } else if (candidate.type === "api-key" && /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(secretName)) {
      const headerName = typeof candidate.headerName === "string" ? candidate.headerName.trim() : "";
      if (!/^x-[a-z0-9-]{1,60}$/i.test(headerName)) {
        throw new GatewayStoreError("CAPABILITY_AUTH_HEADER_INVALID", 400);
      }
      auth = { type: "api-key", secretName, headerName };
    } else if (candidate.type !== "none") {
      throw new GatewayStoreError("CAPABILITY_AUTH_CONFIG_INVALID", 400);
    }
  }
  return {
    baseUrl,
    pathTemplate,
    method,
    timeoutMs,
    maxResponseBytes,
    allowedQueryParams,
    allowedJsonBodyParams,
    staticJsonBody: staticJsonBodyRecord,
    auth,
  };
}

function connectionFromRow(
  db: Database.Database,
  row: ConnectionRow,
): GatewayConnection {
  const secretNames = (db.prepare(
    `SELECT secret_name AS name FROM encrypted_secrets WHERE connection_id = ?
     UNION
     SELECT secret_name AS name FROM stored_credential_bindings WHERE connection_id = ?
     ORDER BY name`,
  ).all(row.id, row.id) as Array<{ name: string }>).map((entry) => entry.name);
  const capabilityKeys = (db.prepare(
    "SELECT key FROM capabilities WHERE connection_id = ? ORDER BY key",
  ).all(row.id) as Array<{ key: string }>).map((entry) => entry.key);
  const toolsetKeys = (db.prepare(
    "SELECT key FROM toolset_profiles WHERE connection_id = ? ORDER BY key",
  ).all(row.id) as Array<{ key: string }>).map((entry) => entry.key);
  return {
    id: row.id,
    key: row.credential_key || row.id,
    provider: row.provider,
    label: row.label,
    authType: row.auth_type,
    configuration: stringRecord(row.configuration_json),
    envBindings: stringRecord(row.env_bindings_json),
    status: row.status,
    capabilityKeys,
    toolsetKeys,
    secretNames,
    lastTestedAt: row.last_tested_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function storedCredentialFromRow(row: StoredCredentialRow): GatewayStoredCredential {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toolsetProfileFromRow(row: ToolsetProfileRow): GatewayToolsetProfile {
  return {
    key: row.key,
    connectionId: row.connection_id,
    protocol: row.protocol,
    discoveryUrl: row.discovery_url,
    auth: (parseJson(row.auth_config_json) || { type: "none" }) as ToolsetAuthConfig,
    envBindings: (parseJson(row.env_bindings_json) || {}) as Record<string, string>,
    description: row.description,
    enabled: row.enabled === 1,
    lastDiscoveredAt: row.last_discovered_at,
    discoveryError: row.discovery_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function capabilityFromRow(row: CapabilityRow): GatewayCapability {
  return {
    key: row.key,
    driverKey: row.driver_key,
    connectionId: row.connection_id,
    provider: row.provider,
    description: row.description,
    mode: row.mode,
    riskLevel: row.risk_level,
    requiresApproval: row.requires_approval === 1,
    enabled: row.enabled === 1,
    inputSchema: parseJson(row.input_schema_json),
    outputSchema: parseJson(row.output_schema_json),
    driverConfig: parseJson(row.driver_config_json) || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function grantFromRow(row: GrantRow): GatewayGrant {
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    capabilityKey: row.capability_key,
    allowed: row.allowed === 1,
    policy: parseJson(row.policy_json) || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function auditFromRow(row: AuditRow): GatewayAuditEvent {
  return {
    id: row.id,
    traceId: row.trace_id,
    capabilityKey: row.capability_key,
    authenticatedCallerId: row.authenticated_caller_id,
    delegatedActorId: row.delegated_actor_id,
    requestId: row.request_id,
    workflowRunId: row.workflow_run_id,
    workflowStepKey: row.workflow_step_key,
    status: row.status,
    policyDecision: row.policy_decision,
    budgetDecision: row.budget_decision,
    latencyMs: row.latency_ms,
    errorCode: row.error_code,
    inputSummary: parseJson(row.input_summary_json),
    outputSummary: parseJson(row.output_summary_json),
    createdAt: row.created_at,
  };
}

export class GatewayStore {
  private readonly decryptionKeys: Map<string, Buffer>;

  constructor(
    private readonly db: Database.Database,
    private readonly encryption: {
      key: Buffer;
      keyVersion: string;
      previousKeys?: Array<{ key: Buffer; keyVersion: string }>;
    },
  ) {
    this.decryptionKeys = new Map([
      [encryption.keyVersion, encryption.key],
      ...(encryption.previousKeys ?? []).map((entry) => [entry.keyVersion, entry.key] as const),
    ]);
    this.backfillCredentialBundles();
  }

  private backfillCredentialBundles() {
    const rows = this.db.prepare(
      "SELECT * FROM integration_connections ORDER BY created_at, id",
    ).all() as ConnectionRow[];
    const usedKeys = new Set(rows.flatMap((row) => row.credential_key ? [row.credential_key] : []));
    const update = this.db.prepare(`
      UPDATE integration_connections
      SET credential_key = ?, configuration_json = ?, env_bindings_json = ?, updated_at = ?
      WHERE id = ?
    `);

    this.db.transaction(() => {
      for (const row of rows) {
        let key = row.credential_key;
        if (!key) {
          const base = credentialKey(row.provider !== "none" ? row.provider : row.label);
          key = base;
          let suffix = 2;
          while (usedKeys.has(key)) key = `${base.slice(0, 116)}-${suffix++}`;
          usedKeys.add(key);
        }

        const configuration = stringRecord(row.configuration_json);
        const envBindings = stringRecord(row.env_bindings_json);
        const toolsets = (this.db.prepare(
          "SELECT * FROM toolset_profiles WHERE connection_id = ? ORDER BY key",
        ).all(row.id) as ToolsetProfileRow[]).map(toolsetProfileFromRow);
        const secretNames = connectionFromRow(this.db, row).secretNames;
        const aliases = toolsets.length ? toolsets.map((toolset) => toolset.key) : [key];

        for (const toolset of toolsets) {
          for (const [envName, secretName] of Object.entries(toolset.envBindings)) {
            if (envBindings[envName] === undefined || envBindings[envName] === secretName) {
              envBindings[envName] = secretName;
            }
          }
          const prefix = environmentPrefix(toolset.key);
          try {
            const discoveryUrl = new URL(toolset.discoveryUrl);
            configuration[`${prefix}_BASE_URL`] ??= discoveryUrl.origin;
            if (discoveryUrl.pathname !== "/" || discoveryUrl.search) {
              configuration[`${prefix}_DISCOVERY_URL`] ??= discoveryUrl.toString();
            }
          } catch {
            // Existing rows were validated when created; leave malformed legacy metadata untouched.
          }
        }

        for (const alias of aliases) {
          const prefix = environmentPrefix(alias);
          for (const secretName of secretNames) {
            const envName = `${prefix}_${secretEnvironmentSuffix(secretName)}`;
            envBindings[envName] ??= secretName;
          }
        }

        const configurationJson = JSON.stringify(configuration);
        const envBindingsJson = JSON.stringify(envBindings);
        if (
          key !== row.credential_key
          || configurationJson !== row.configuration_json
          || envBindingsJson !== row.env_bindings_json
        ) {
          update.run(
            key,
            configurationJson,
            envBindingsJson,
            new Date().toISOString(),
            row.id,
          );
        }
      }
    })();
  }

  encryptionStatus() {
    const connectionVersions = this.db.prepare(`
      SELECT key_version AS keyVersion, COUNT(*) AS count
      FROM encrypted_secrets GROUP BY key_version ORDER BY key_version
    `).all() as Array<{ keyVersion: string; count: number }>;
    const storedVersions = this.db.prepare(`
      SELECT key_version AS keyVersion, COUNT(*) AS count
      FROM stored_credentials GROUP BY key_version ORDER BY key_version
    `).all() as Array<{ keyVersion: string; count: number }>;
    const versionCounts = new Map<string, number>();
    for (const entry of [...connectionVersions, ...storedVersions]) {
      versionCounts.set(entry.keyVersion, (versionCounts.get(entry.keyVersion) ?? 0) + entry.count);
    }
    const versions = Array.from(versionCounts, ([keyVersion, count]) => ({ keyVersion, count }))
      .sort((left, right) => left.keyVersion.localeCompare(right.keyVersion));
    const rows = this.db.prepare(`
      SELECT connection_id, secret_name, encrypted_value AS encryptedValue,
        nonce, auth_tag AS authTag, key_version AS keyVersion,
        associated_data_json AS associatedDataJson
      FROM encrypted_secrets
    `).all() as Array<SecretRow & { connection_id: string }>;
    let unreadableSecretCount = 0;
    for (const row of rows) {
      const key = this.decryptionKeys.get(row.keyVersion);
      if (!key) {
        unreadableSecretCount += 1;
        continue;
      }
      try {
        decryptSecret(row, {
          connectionId: row.connection_id,
          secretName: row.secret_name,
          key,
        });
      } catch {
        unreadableSecretCount += 1;
      }
    }
    const storedRows = this.db.prepare(`
      SELECT id, name, source, encrypted_value AS encryptedValue,
        nonce, auth_tag AS authTag, key_version AS keyVersion,
        associated_data_json AS associatedDataJson, created_at, updated_at
      FROM stored_credentials
    `).all() as StoredCredentialRow[];
    for (const row of storedRows) {
      const key = this.decryptionKeys.get(row.keyVersion);
      if (!key) {
        unreadableSecretCount += 1;
        continue;
      }
      try {
        decryptSecret(row, {
          connectionId: `stored:${row.id}`,
          secretName: row.name,
          key,
        });
      } catch {
        unreadableSecretCount += 1;
      }
    }
    return {
      currentKeyVersion: this.encryption.keyVersion,
      encryptedSecretCount: versions.reduce((total, entry) => total + entry.count, 0),
      unreadableSecretCount,
      versions,
      rotationRequired: versions.some((entry) => entry.keyVersion !== this.encryption.keyVersion),
      unavailableVersions: versions
        .map((entry) => entry.keyVersion)
        .filter((version) => !this.decryptionKeys.has(version)),
    };
  }

  rotateEncryptionKey() {
    const rows = this.db.prepare(`
      SELECT id, connection_id, secret_name, encrypted_value AS encryptedValue,
        nonce, auth_tag AS authTag, key_version AS keyVersion,
        associated_data_json AS associatedDataJson
      FROM encrypted_secrets ORDER BY connection_id, secret_name
    `).all() as Required<SecretRow>[];
    const pending = rows.filter((row) => row.keyVersion !== this.encryption.keyVersion);
    const storedRows = this.db.prepare(`
      SELECT id, name, source, encrypted_value AS encryptedValue,
        nonce, auth_tag AS authTag, key_version AS keyVersion,
        associated_data_json AS associatedDataJson, created_at, updated_at
      FROM stored_credentials ORDER BY name
    `).all() as StoredCredentialRow[];
    const storedPending = storedRows.filter((row) => row.keyVersion !== this.encryption.keyVersion);

    const update = this.db.prepare(`
      UPDATE encrypted_secrets
      SET encrypted_value = ?, nonce = ?, auth_tag = ?, key_version = ?,
        associated_data_json = ?, updated_at = ?
      WHERE id = ?
    `);
    this.db.transaction(() => {
      for (const row of pending) {
        const previousKey = this.decryptionKeys.get(row.keyVersion);
        if (!previousKey) throw new GatewayStoreError("ENCRYPTION_KEY_VERSION_UNAVAILABLE", 409);
        const plaintext = decryptSecret(row, {
          connectionId: row.connection_id,
          secretName: row.secret_name,
          key: previousKey,
        });
        const encrypted = encryptSecret(plaintext, {
          connectionId: row.connection_id,
          secretName: row.secret_name,
          key: this.encryption.key,
          keyVersion: this.encryption.keyVersion,
        });
        update.run(
          encrypted.encryptedValue,
          encrypted.nonce,
          encrypted.authTag,
          encrypted.keyVersion,
          encrypted.associatedDataJson,
          new Date().toISOString(),
          row.id,
        );
      }
      const updateStored = this.db.prepare(`
        UPDATE stored_credentials
        SET encrypted_value = ?, nonce = ?, auth_tag = ?, key_version = ?,
          associated_data_json = ?, updated_at = ?
        WHERE id = ?
      `);
      for (const row of storedPending) {
        const previousKey = this.decryptionKeys.get(row.keyVersion);
        if (!previousKey) throw new GatewayStoreError("ENCRYPTION_KEY_VERSION_UNAVAILABLE", 409);
        const plaintext = decryptSecret(row, {
          connectionId: `stored:${row.id}`,
          secretName: row.name,
          key: previousKey,
        });
        const encrypted = encryptSecret(plaintext, {
          connectionId: `stored:${row.id}`,
          secretName: row.name,
          key: this.encryption.key,
          keyVersion: this.encryption.keyVersion,
        });
        updateStored.run(
          encrypted.encryptedValue,
          encrypted.nonce,
          encrypted.authTag,
          encrypted.keyVersion,
          encrypted.associatedDataJson,
          new Date().toISOString(),
          row.id,
        );
      }
    })();
    return {
      rotated: pending.length + storedPending.length,
      skipped: rows.length - pending.length + storedRows.length - storedPending.length,
      ...this.encryptionStatus(),
    };
  }

  seedBuiltInDrivers() {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO connector_drivers (key, mode, description, built_in, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        mode = excluded.mode,
        description = excluded.description,
        updated_at = excluded.updated_at
    `).run(
      "http-json.read",
      "read",
      "Constrained JSON GET or POST requests to an admin-configured public HTTPS origin.",
      now,
      now,
    );
    this.db.prepare(`
      INSERT INTO connector_drivers (key, mode, description, built_in, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        mode = excluded.mode,
        description = excluded.description,
        updated_at = excluded.updated_at
    `).run(
      "mcp-tool.call",
      "read",
      "Constrained calls to admin-allowlisted tools on a fixed public Streamable HTTP MCP endpoint.",
      now,
      now,
    );
  }

  stats() {
    const count = (table: string) => (
      this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
    ).count;
    return {
      drivers: count("connector_drivers"),
      capabilities: count("capabilities"),
      toolsets: count("toolset_profiles"),
      connections: count("integration_connections"),
      credentials: count("stored_credentials"),
      auditEvents: count("audit_events"),
    };
  }

  listStoredCredentials() {
    return (this.db.prepare(
      "SELECT * FROM stored_credentials ORDER BY name",
    ).all() as StoredCredentialRow[]).map(storedCredentialFromRow);
  }

  upsertStoredCredentials(
    credentials: Record<string, string>,
    source: GatewayStoredCredential["source"] = "environment-import",
  ) {
    const entries = Object.entries(credentials);
    if (!entries.length || entries.length > 100) {
      throw new GatewayStoreError("STORED_CREDENTIALS_INVALID", 400);
    }
    const select = this.db.prepare("SELECT id, created_at FROM stored_credentials WHERE name = ?");
    const upsert = this.db.prepare(`
      INSERT INTO stored_credentials
        (id, name, source, encrypted_value, nonce, auth_tag, key_version,
         associated_data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        source = excluded.source,
        encrypted_value = excluded.encrypted_value,
        nonce = excluded.nonce,
        auth_tag = excluded.auth_tag,
        key_version = excluded.key_version,
        associated_data_json = excluded.associated_data_json,
        updated_at = excluded.updated_at
    `);
    const imported: GatewayStoredCredential[] = [];
    this.db.transaction(() => {
      for (const [name, value] of entries) {
        if (!/^[A-Z_][A-Z0-9_]{0,119}$/.test(name) || !value || value.length > 100_000) {
          throw new GatewayStoreError("STORED_CREDENTIAL_INVALID", 400);
        }
        const existing = select.get(name) as { id: string; created_at: string } | undefined;
        const id = existing?.id ?? randomUUID();
        const now = new Date().toISOString();
        const encrypted = encryptSecret(value, {
          connectionId: `stored:${id}`,
          secretName: name,
          keyVersion: this.encryption.keyVersion,
          key: this.encryption.key,
        });
        upsert.run(
          id, name, source, encrypted.encryptedValue, encrypted.nonce,
          encrypted.authTag, encrypted.keyVersion, encrypted.associatedDataJson,
          existing?.created_at ?? now, now,
        );
        const row = this.db.prepare("SELECT * FROM stored_credentials WHERE id = ?").get(id) as StoredCredentialRow;
        imported.push(storedCredentialFromRow(row));
      }
    })();
    return imported;
  }

  bindStoredCredentials(connectionId: string, bindings: Record<string, string>) {
    const connection = this.getConnection(connectionId);
    if (!connection || connection.status === "revoked") {
      throw new GatewayStoreError("CONNECTION_UNAVAILABLE", 404);
    }
    const entries = Object.entries(bindings);
    if (!entries.length || entries.length > 20) {
      throw new GatewayStoreError("STORED_CREDENTIAL_BINDINGS_INVALID", 400);
    }
    const resolved = entries.map(([secretName, storedName]) => {
      if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(secretName) || !/^[A-Z_][A-Z0-9_]{0,119}$/.test(storedName)) {
        throw new GatewayStoreError("STORED_CREDENTIAL_BINDING_INVALID", 400);
      }
      const stored = this.db.prepare(
        "SELECT id FROM stored_credentials WHERE name = ?",
      ).get(storedName) as { id: string } | undefined;
      if (!stored) throw new GatewayStoreError("STORED_CREDENTIAL_NOT_FOUND", 404);
      return { secretName, storedCredentialId: stored.id };
    });
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM encrypted_secrets WHERE connection_id = ?").run(connectionId);
      this.db.prepare("DELETE FROM stored_credential_bindings WHERE connection_id = ?").run(connectionId);
      const insert = this.db.prepare(`
        INSERT INTO stored_credential_bindings
          (connection_id, secret_name, stored_credential_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const binding of resolved) {
        insert.run(connectionId, binding.secretName, binding.storedCredentialId, now, now);
      }
      this.db.prepare(`
        UPDATE integration_connections
        SET status = 'untested', last_tested_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, connectionId);
    })();
    return this.getConnection(connectionId)!;
  }

  listToolsetProfiles() {
    return (this.db.prepare("SELECT * FROM toolset_profiles ORDER BY key").all() as ToolsetProfileRow[])
      .map(toolsetProfileFromRow);
  }

  getToolsetProfile(key: string) {
    const row = this.db.prepare("SELECT * FROM toolset_profiles WHERE key = ?").get(key) as ToolsetProfileRow | undefined;
    return row ? toolsetProfileFromRow(row) : null;
  }

  createToolsetProfile(input: {
    key: string;
    connectionId: string;
    protocol: GatewayToolsetProfile["protocol"];
    discoveryUrl: string;
    auth: ToolsetAuthConfig;
    envBindings?: Record<string, string>;
    description: string;
    enabled?: boolean;
  }) {
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(input.key)) {
      throw new GatewayStoreError("TOOLSET_KEY_INVALID", 400);
    }
    const connection = this.getConnection(input.connectionId);
    if (!connection || connection.status === "revoked") {
      throw new GatewayStoreError("TOOLSET_CONNECTION_UNAVAILABLE", 400);
    }
    if (!["openapi", "mcp", "http", "adapter"].includes(input.protocol)) {
      throw new GatewayStoreError("TOOLSET_PROTOCOL_INVALID", 400);
    }
    const discoveryUrl = validatePublicHttpsUrl(input.discoveryUrl, "TOOLSET_DISCOVERY_URL");
    const now = new Date().toISOString();
    try {
      this.db.prepare(`
        INSERT INTO toolset_profiles
          (key, connection_id, protocol, discovery_url, auth_config_json, env_bindings_json, description, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.key, input.connectionId, input.protocol, discoveryUrl, JSON.stringify(input.auth), JSON.stringify(input.envBindings || {}), input.description, input.enabled === false ? 0 : 1, now, now);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        throw new GatewayStoreError("TOOLSET_ALREADY_EXISTS", 409);
      }
      throw error;
    }
    return this.getToolsetProfile(input.key)!;
  }

  updateToolsetProfile(key: string, input: { description?: string; enabled?: boolean; envBindings?: Record<string, string> }) {
    if (!this.getToolsetProfile(key)) throw new GatewayStoreError("TOOLSET_NOT_FOUND", 404);
    const updates: string[] = [];
    const values: unknown[] = [];
    if (input.description !== undefined) {
      updates.push("description = ?");
      values.push(input.description);
    }
    if (input.enabled !== undefined) {
      updates.push("enabled = ?");
      values.push(input.enabled ? 1 : 0);
    }
    if (input.envBindings !== undefined) {
      updates.push("env_bindings_json = ?");
      values.push(JSON.stringify(input.envBindings));
    }
    if (!updates.length) throw new GatewayStoreError("TOOLSET_UPDATE_REQUIRED", 400);
    updates.push("updated_at = ?");
    values.push(new Date().toISOString(), key);
    this.db.prepare(`UPDATE toolset_profiles SET ${updates.join(", ")} WHERE key = ?`).run(...values);
    return this.getToolsetProfile(key)!;
  }

  listDrivers() {
    return this.db.prepare(`
      SELECT key, mode, description, built_in AS builtIn, created_at AS createdAt, updated_at AS updatedAt
      FROM connector_drivers ORDER BY key
    `).all();
  }

  listConnections() {
    const rows = this.db.prepare(
      "SELECT * FROM integration_connections ORDER BY label, id",
    ).all() as ConnectionRow[];
    return rows.map((row) => connectionFromRow(this.db, row));
  }

  getConnection(id: string) {
    const row = this.db.prepare(
      "SELECT * FROM integration_connections WHERE id = ?",
    ).get(id) as ConnectionRow | undefined;
    return row ? connectionFromRow(this.db, row) : null;
  }

  getCredential(keyOrAlias: string) {
    const direct = this.db.prepare(
      "SELECT * FROM integration_connections WHERE credential_key = ? OR id = ?",
    ).get(keyOrAlias, keyOrAlias) as ConnectionRow | undefined;
    if (direct) return connectionFromRow(this.db, direct);
    const alias = this.db.prepare(`
      SELECT connection_id FROM toolset_profiles WHERE key = ?
    `).get(keyOrAlias) as { connection_id: string } | undefined;
    return alias ? this.getConnection(alias.connection_id) : null;
  }

  createConnection(input: {
    key?: string;
    provider: string;
    label: string;
    authType: string;
    credentials: Record<string, string>;
    configuration?: Record<string, string>;
    envBindings?: Record<string, string>;
  }) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const entries = Object.entries(input.credentials);
    const key = credentialKey(input.key || input.label);
    const configuration = input.configuration ?? {};
    const prefix = environmentPrefix(key);
    const envBindings = input.envBindings ?? Object.fromEntries(
      entries.map(([name]) => [`${prefix}_${secretEnvironmentSuffix(name)}`, name]),
    );
    validateCredentialConfiguration(configuration);
    validateCredentialEnvBindings(envBindings);
    if (this.getCredential(key)) throw new GatewayStoreError("CREDENTIAL_KEY_CONFLICT", 409);

    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO integration_connections
          (id, credential_key, provider, label, auth_type, configuration_json,
           env_bindings_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'untested', ?, ?)
      `).run(
        id,
        key,
        input.provider,
        input.label,
        input.authType,
        JSON.stringify(configuration),
        JSON.stringify(envBindings),
        now,
        now,
      );
      if (entries.length > 0) this.writeCredentials(id, entries, now);
    })();

    return this.getConnection(id)!;
  }

  updateCredentialBundle(id: string, input: {
    label?: string;
    authType?: string;
    configuration?: Record<string, string>;
    envBindings?: Record<string, string>;
  }) {
    const connection = this.getConnection(id);
    if (!connection) throw new GatewayStoreError("CONNECTION_NOT_FOUND", 404);
    if (connection.status === "revoked") throw new GatewayStoreError("CONNECTION_UNAVAILABLE", 409);
    const configuration = input.configuration ?? connection.configuration;
    const envBindings = input.envBindings ?? connection.envBindings;
    validateCredentialConfiguration(configuration);
    validateCredentialEnvBindings(envBindings);
    const label = input.label?.trim() || connection.label;
    const authType = input.authType?.trim() || connection.authType;
    this.db.prepare(`
      UPDATE integration_connections
      SET label = ?, auth_type = ?, configuration_json = ?, env_bindings_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      label,
      authType,
      JSON.stringify(configuration),
      JSON.stringify(envBindings),
      new Date().toISOString(),
      id,
    );
    return this.getConnection(id)!;
  }

  replaceConnectionCredentials(id: string, credentials: Record<string, string>) {
    const entries = Object.entries(credentials);
    if (!this.getConnection(id)) throw new GatewayStoreError("CONNECTION_NOT_FOUND", 404);
    if (entries.length === 0) throw new GatewayStoreError("CONNECTION_CREDENTIALS_REQUIRED", 400);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM encrypted_secrets WHERE connection_id = ?").run(id);
      this.db.prepare("DELETE FROM stored_credential_bindings WHERE connection_id = ?").run(id);
      this.writeCredentials(id, entries, now);
      this.db.prepare(`
        UPDATE integration_connections
        SET status = 'untested', last_tested_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, id);
    })();
    return this.getConnection(id)!;
  }

  revokeConnection(id: string) {
    if (!this.getConnection(id)) throw new GatewayStoreError("CONNECTION_NOT_FOUND", 404);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM encrypted_secrets WHERE connection_id = ?").run(id);
      this.db.prepare("DELETE FROM stored_credential_bindings WHERE connection_id = ?").run(id);
      this.db.prepare(`
        UPDATE integration_connections SET status = 'revoked', updated_at = ? WHERE id = ?
      `).run(now, id);
    })();
    return this.getConnection(id)!;
  }

  getConnectionCredentials(id: string) {
    if (!this.getConnection(id)) throw new GatewayStoreError("CONNECTION_NOT_FOUND", 404);
    const rows = this.db.prepare(`
      SELECT
        secret_name,
        encrypted_value AS encryptedValue,
        nonce,
        auth_tag AS authTag,
        key_version AS keyVersion,
        associated_data_json AS associatedDataJson
      FROM encrypted_secrets WHERE connection_id = ? ORDER BY secret_name
    `).all(id) as SecretRow[];
    const credentials: Record<string, string> = Object.fromEntries(rows.map((row) => [
      row.secret_name,
      decryptSecret(row, {
        connectionId: id,
        secretName: row.secret_name,
        key: this.decryptionKeys.get(row.keyVersion)
          ?? (() => { throw new GatewayStoreError("ENCRYPTION_KEY_VERSION_UNAVAILABLE", 503); })(),
      }),
    ]));
    const bindings = this.db.prepare(`
      SELECT b.secret_name, c.id, c.name, c.source,
        c.encrypted_value AS encryptedValue, c.nonce,
        c.auth_tag AS authTag, c.key_version AS keyVersion,
        c.associated_data_json AS associatedDataJson,
        c.created_at, c.updated_at
      FROM stored_credential_bindings b
      JOIN stored_credentials c ON c.id = b.stored_credential_id
      WHERE b.connection_id = ?
      ORDER BY b.secret_name
    `).all(id) as Array<StoredCredentialRow & { secret_name: string }>;
    for (const binding of bindings) {
      const key = this.decryptionKeys.get(binding.keyVersion);
      if (!key) throw new GatewayStoreError("ENCRYPTION_KEY_VERSION_UNAVAILABLE", 503);
      credentials[binding.secret_name] = decryptSecret(binding, {
        connectionId: `stored:${binding.id}`,
        secretName: binding.name,
        key,
      });
    }
    return credentials;
  }

  private writeCredentials(id: string, entries: Array<[string, string]>, now: string) {
    const insert = this.db.prepare(`
      INSERT INTO encrypted_secrets
        (id, connection_id, secret_name, encrypted_value, nonce, auth_tag, key_version,
         associated_data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [secretName, value] of entries) {
      if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(secretName) || !value) {
        throw new GatewayStoreError("CONNECTION_CREDENTIAL_INVALID", 400);
      }
      const encrypted = encryptSecret(value, {
        connectionId: id,
        secretName,
        keyVersion: this.encryption.keyVersion,
        key: this.encryption.key,
      });
      insert.run(
        randomUUID(), id, secretName, encrypted.encryptedValue, encrypted.nonce,
        encrypted.authTag, encrypted.keyVersion, encrypted.associatedDataJson, now, now,
      );
    }
  }

  listCapabilities() {
    const rows = this.db.prepare("SELECT * FROM capabilities ORDER BY key").all() as CapabilityRow[];
    return rows.map(capabilityFromRow);
  }

  getCapability(key: string) {
    const row = this.db.prepare("SELECT * FROM capabilities WHERE key = ?").get(key) as CapabilityRow | undefined;
    return row ? capabilityFromRow(row) : null;
  }

  setCapabilityEnabled(key: string, enabled: boolean) {
    const result = this.db.prepare(
      "UPDATE capabilities SET enabled = ?, updated_at = ? WHERE key = ?",
    ).run(enabled ? 1 : 0, new Date().toISOString(), key);
    if (result.changes === 0) throw new GatewayStoreError("CAPABILITY_NOT_FOUND", 404);
    return this.getCapability(key)!;
  }

  updateCapabilityConfig(key: string, driverConfigValue: unknown) {
    const capability = this.getCapability(key);
    if (!capability) throw new GatewayStoreError("CAPABILITY_NOT_FOUND", 404);
    if (capability.driverKey !== "http-json.read" && capability.driverKey !== "mcp-tool.call") {
      throw new GatewayStoreError("CAPABILITY_DRIVER_UNSUPPORTED", 400);
    }
    const driverConfig = capability.driverKey === "http-json.read"
      ? normalizeHttpJsonReadConfig(driverConfigValue)
      : normalizeMcpToolCallConfig(driverConfigValue);
    this.db.prepare(
      "UPDATE capabilities SET driver_config_json = ?, updated_at = ? WHERE key = ?",
    ).run(JSON.stringify(driverConfig), new Date().toISOString(), key);
    return this.getCapability(key)!;
  }

  updateCapabilityMetadata(key: string, input: {
    description?: string;
    inputSchema?: Record<string, unknown> | null;
    outputSchema?: Record<string, unknown> | null;
  }) {
    const capability = this.getCapability(key);
    if (!capability) throw new GatewayStoreError("CAPABILITY_NOT_FOUND", 404);
    const updates: string[] = [];
    const values: unknown[] = [];
    if (input.description !== undefined) {
      updates.push("description = ?");
      values.push(input.description);
    }
    if (input.inputSchema !== undefined) {
      updates.push("input_schema_json = ?");
      values.push(input.inputSchema ? JSON.stringify(input.inputSchema) : null);
    }
    if (input.outputSchema !== undefined) {
      updates.push("output_schema_json = ?");
      values.push(input.outputSchema ? JSON.stringify(input.outputSchema) : null);
    }
    if (!updates.length) return capability;
    updates.push("updated_at = ?");
    values.push(new Date().toISOString(), key);
    this.db.prepare(`UPDATE capabilities SET ${updates.join(", ")} WHERE key = ?`).run(...values);
    return this.getCapability(key)!;
  }

  createCapability(input: {
    key: string;
    driverKey: string;
    connectionId: string;
    provider: string;
    description: string;
    driverConfig: unknown;
    inputSchema?: Record<string, unknown> | null;
    outputSchema?: Record<string, unknown> | null;
    enabled?: boolean;
  }) {
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(input.key)) {
      throw new GatewayStoreError("CAPABILITY_KEY_INVALID", 400);
    }
    if (input.driverKey !== "http-json.read" && input.driverKey !== "mcp-tool.call") {
      throw new GatewayStoreError("CAPABILITY_DRIVER_UNSUPPORTED", 400);
    }
    const connection = this.getConnection(input.connectionId);
    if (!connection || connection.status === "revoked") {
      throw new GatewayStoreError("CAPABILITY_CONNECTION_UNAVAILABLE", 400);
    }
    if (connection.provider !== input.provider) {
      throw new GatewayStoreError("CAPABILITY_CONNECTION_PROVIDER_MISMATCH", 400);
    }
    const driverConfig = input.driverKey === "http-json.read"
      ? normalizeHttpJsonReadConfig(input.driverConfig)
      : normalizeMcpToolCallConfig(input.driverConfig);
    const now = new Date().toISOString();
    try {
      this.db.prepare(`
        INSERT INTO capabilities
          (key, driver_key, connection_id, provider, mode, description, driver_config_json,
           input_schema_json, output_schema_json, risk_level, requires_approval,
           default_unit_price, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'read', ?, ?, ?, ?, 'low', 0, 0, ?, ?, ?)
      `).run(
        input.key,
        input.driverKey,
        input.connectionId,
        input.provider,
        input.description,
        JSON.stringify(driverConfig),
        input.inputSchema ? JSON.stringify(input.inputSchema) : null,
        input.outputSchema ? JSON.stringify(input.outputSchema) : null,
        input.enabled === false ? 0 : 1,
        now,
        now,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        throw new GatewayStoreError("CAPABILITY_ALREADY_EXISTS", 409);
      }
      throw error;
    }
    return this.listCapabilities().find((capability) => capability.key === input.key)!;
  }

  listGrants() {
    return (this.db.prepare("SELECT * FROM capability_grants ORDER BY subject_type, subject_id, capability_key").all() as GrantRow[])
      .map(grantFromRow);
  }

  upsertGrant(input: {
    id: string;
    subjectType: GatewayGrant["subjectType"];
    subjectId: string;
    capabilityKey: string;
    allowed: boolean;
    policy?: Record<string, unknown>;
  }) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(input.id)) {
      throw new GatewayStoreError("GRANT_ID_INVALID", 400);
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(input.subjectId)) {
      throw new GatewayStoreError("GRANT_SUBJECT_ID_INVALID", 400);
    }
    if (!this.getCapability(input.capabilityKey)) throw new GatewayStoreError("CAPABILITY_NOT_FOUND", 404);
    const now = new Date().toISOString();
    try {
      this.db.prepare(`
        INSERT INTO capability_grants
          (id, subject_type, subject_id, capability_key, allowed, policy_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          subject_type = excluded.subject_type,
          subject_id = excluded.subject_id,
          capability_key = excluded.capability_key,
          allowed = excluded.allowed,
          policy_json = excluded.policy_json,
          updated_at = excluded.updated_at
      `).run(
        input.id,
        input.subjectType,
        input.subjectId,
        input.capabilityKey,
        input.allowed ? 1 : 0,
        JSON.stringify(input.policy || {}),
        now,
        now,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        throw new GatewayStoreError("GRANT_ALREADY_EXISTS", 409);
      }
      throw error;
    }
    return grantFromRow(this.db.prepare("SELECT * FROM capability_grants WHERE id = ?").get(input.id) as GrantRow);
  }

  evaluateCallerGrant(caller: GatewayCaller, capabilityKey: string) {
    const subjectType = caller.kind === "runtime" ? "runtime" : "service";
    const subjectId = caller.kind === "runtime" ? caller.runtimeKey : caller.id;
    if (!subjectId) return { allowed: false, decision: "caller_identity_incomplete" };
    const row = this.db.prepare(`
      SELECT * FROM capability_grants
      WHERE subject_type = ? AND subject_id = ? AND capability_key = ?
    `).get(subjectType, subjectId, capabilityKey) as GrantRow | undefined;
    if (!row) return { allowed: false, decision: "default_deny_no_grant" };
    return { allowed: row.allowed === 1, decision: row.allowed === 1 ? "explicit_allow" : "explicit_deny" };
  }

  markConnectionUsed(id: string, healthy: boolean) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE integration_connections
      SET status = ?, last_tested_at = ?,
          last_used_at = CASE WHEN ? = 1 THEN ? ELSE last_used_at END,
          updated_at = ?
      WHERE id = ?
    `).run(healthy ? "healthy" : "unhealthy", now, healthy ? 1 : 0, now, now, id);
  }

  markConnectionLeased(id: string) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE integration_connections
      SET status = CASE WHEN status = 'untested' THEN 'leased' ELSE status END,
          last_used_at = ?, updated_at = ?
      WHERE id = ? AND status != 'revoked'
    `).run(now, now, id);
  }

  recordInvocation(input: {
    traceId: string;
    capabilityKey: string;
    caller: GatewayCaller;
    context: GatewayInvocationContext;
    status: GatewayAuditEvent["status"];
    policyDecision: string;
    latencyMs: number;
    errorCode?: string | null;
    inputSummary: Record<string, unknown>;
    outputSummary?: Record<string, unknown> | null;
    units: number;
    unitPrice?: number;
  }) {
    const now = new Date().toISOString();
    const unitPrice = input.unitPrice || 0;
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO audit_events
          (id, trace_id, capability_key, authenticated_caller_id, delegated_actor_id,
           request_id, workflow_run_id, workflow_step_key, status, policy_decision,
           budget_decision, latency_ms, error_code, input_summary_json, output_summary_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'warn_only', ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), input.traceId, input.capabilityKey, input.caller.id,
        input.context.delegatedActorId || null, input.context.requestId || null,
        input.context.workflowRunId || null, input.context.workflowStepKey || null,
        input.status, input.policyDecision, input.latencyMs, input.errorCode || null,
        JSON.stringify(input.inputSummary), input.outputSummary ? JSON.stringify(input.outputSummary) : null, now,
      );
      this.db.prepare(`
        INSERT INTO usage_ledger
          (id, trace_id, capability_key, authenticated_caller_id, delegated_actor_id,
           request_id, units, unit_price, estimated_cost, actual_cost, settlement_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'shadow', ?)
      `).run(
        randomUUID(), input.traceId, input.capabilityKey, input.caller.id,
        input.context.delegatedActorId || null, input.context.requestId || null,
        input.units, unitPrice, input.units * unitPrice, now,
      );
    })();
  }

  listAuditEvents(limit = 100) {
    const normalized = Math.min(Math.max(limit, 1), 500);
    return (this.db.prepare("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?").all(normalized) as AuditRow[])
      .map(auditFromRow);
  }

  getAuditEvent(traceId: string) {
    const row = this.db.prepare("SELECT * FROM audit_events WHERE trace_id = ?").get(traceId) as AuditRow | undefined;
    return row ? auditFromRow(row) : null;
  }
}
