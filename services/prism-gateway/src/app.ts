import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { gatewayAuth, requireRuntimeCaller, requireSiteCaller } from "./auth.js";
import { GatewayInvoker } from "./invoke.js";
import { GatewayStore, GatewayStoreError } from "./store.js";
import { GatewayDriverError } from "./http-json-read.js";
import { executeToolsetRequest, type HttpToolsetRequest, type ToolsetRequest } from "./toolset-relay.js";
import type { GatewayCaller, GatewayConfig, GatewayInvocationContext } from "./types.js";

type AppDependencies = {
  config: GatewayConfig;
  db: Database.Database;
  store: GatewayStore;
  invoker: GatewayInvoker;
  migrationCount: number;
  startedAt?: Date;
  executeToolset?: typeof executeToolsetRequest;
};

function textField(value: unknown, field: string, maxLength = 200) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maxLength) {
    throw new GatewayStoreError(`${field.toUpperCase()}_INVALID`, 400);
  }
  return normalized;
}

function credentialsField(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GatewayStoreError("CONNECTION_CREDENTIALS_REQUIRED", 400);
  }
  const credentials: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (typeof candidate !== "string" || !candidate) {
      throw new GatewayStoreError("CONNECTION_CREDENTIAL_INVALID", 400);
    }
    credentials[key] = candidate;
  }
  return credentials;
}

function isProtectedStoredCredentialName(name: string) {
  return name.startsWith("RAILWAY_")
    || name.startsWith("GATEWAY_")
    || name.startsWith("PRISM_")
    || name.startsWith("BAK_")
    || name === "INTERNAL_SERVICE_TOKEN"
    || name === "APP_API_SERVICE_TOKEN"
    || name === "PRISM_AGENT_SERVICE_TOKEN"
    || name === "TASK_RUNNER_TOKEN"
    || name === "COMMUNICATION_ADAPTER_TOKEN"
    || /_PRISM_API_(?:READ_)?KEY$/.test(name)
    || /^CODEX_(?:ACCESS|REFRESH|ID)_TOKEN$/.test(name);
}

function storedCredentialsField(value: unknown) {
  const credentials = credentialsField(value);
  if (Object.keys(credentials).length > 100) {
    throw new GatewayStoreError("STORED_CREDENTIALS_INVALID", 400);
  }
  if (Object.keys(credentials).some(isProtectedStoredCredentialName)) {
    throw new GatewayStoreError("STORED_CREDENTIAL_PROTECTED", 400);
  }
  return credentials;
}

function storedCredentialBindingsField(value: unknown) {
  const input = recordField(value, "STORED_CREDENTIAL_BINDINGS_INVALID");
  const bindings: Record<string, string> = {};
  for (const [secretName, storedName] of Object.entries(input)) {
    if (
      !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(secretName)
      || typeof storedName !== "string"
      || !/^[A-Z_][A-Z0-9_]{0,119}$/.test(storedName)
    ) throw new GatewayStoreError("STORED_CREDENTIAL_BINDING_INVALID", 400);
    bindings[secretName] = storedName;
  }
  if (!Object.keys(bindings).length || Object.keys(bindings).length > 20) {
    throw new GatewayStoreError("STORED_CREDENTIAL_BINDINGS_INVALID", 400);
  }
  return bindings;
}

function envBindingsField(value: unknown) {
  if (value === undefined) return {};
  const input = recordField(value, "TOOLSET_ENV_BINDINGS_INVALID");
  const bindings: Record<string, string> = {};
  for (const [envName, secretName] of Object.entries(input)) {
    if (!/^[A-Z_][A-Z0-9_]{0,119}$/.test(envName) || typeof secretName !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,119}$/.test(secretName)) {
      throw new GatewayStoreError("TOOLSET_ENV_BINDINGS_INVALID", 400);
    }
    bindings[envName] = secretName;
  }
  if (Object.keys(bindings).length > 20) throw new GatewayStoreError("TOOLSET_ENV_BINDINGS_INVALID", 400);
  return bindings;
}

function optionalSchema(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new GatewayStoreError("CAPABILITY_SCHEMA_INVALID", 400);
  }
  return value as Record<string, unknown>;
}

function toolsetAuthField(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GatewayStoreError("TOOLSET_AUTH_INVALID", 400);
  }
  const auth = value as Record<string, unknown>;
  if (auth.type === "none") return { type: "none" } as const;
  if (auth.type === "payload-login") {
    const emailSecretName = textField(auth.emailSecretName, "toolset_auth_email_secret_name", 64);
    const passwordSecretName = textField(auth.passwordSecretName, "toolset_auth_password_secret_name", 64);
    const loginPath = typeof auth.loginPath === "string" && auth.loginPath.trim() ? auth.loginPath.trim() : "/api/users/login";
    if (
      !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(emailSecretName)
      || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(passwordSecretName)
      || !loginPath.startsWith("/") || loginPath.startsWith("//") || loginPath.includes("\\")
    ) throw new GatewayStoreError("TOOLSET_AUTH_INVALID", 400);
    return { type: "payload-login", emailSecretName, passwordSecretName, loginPath } as const;
  }
  const secretName = textField(auth.secretName, "toolset_auth_secret_name", 64);
  if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(secretName)) throw new GatewayStoreError("TOOLSET_AUTH_INVALID", 400);
  if (auth.type === "bearer") return { type: "bearer", secretName } as const;
  if (auth.type === "api-key") {
    const headerName = textField(auth.headerName, "toolset_auth_header_name", 64);
    if (!/^[a-zA-Z][a-zA-Z0-9-]{0,63}$/.test(headerName)) throw new GatewayStoreError("TOOLSET_AUTH_INVALID", 400);
    return { type: "api-key", secretName, headerName } as const;
  }
  throw new GatewayStoreError("TOOLSET_AUTH_INVALID", 400);
}

function routeParam(value: string | string[]) {
  return Array.isArray(value) ? value[0] || "" : value;
}

function recordField(value: unknown, errorCode: string) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new GatewayStoreError(errorCode, 400);
  return value as Record<string, unknown>;
}

function invocationContext(value: unknown): GatewayInvocationContext {
  const input = recordField(value, "INVOCATION_CONTEXT_INVALID");
  const result: GatewayInvocationContext = {};
  for (const key of ["delegatedActorId", "requestId", "workflowRunId", "workflowStepKey", "runtimeJobId"] as const) {
    const candidate = input[key];
    if (candidate === undefined || candidate === null || candidate === "") continue;
    if (typeof candidate !== "string" || candidate.length > 200) {
      throw new GatewayStoreError("INVOCATION_CONTEXT_INVALID", 400);
    }
    result[key] = candidate;
  }
  return result;
}

function toolsetRequestField(value: unknown, protocol: string): ToolsetRequest {
  const input = recordField(value, "TOOLSET_REQUEST_INVALID");
  if (protocol === "mcp") {
    return {
      tool: textField(input.tool, "toolset_tool", 200),
      arguments: recordField(input.arguments ?? {}, "TOOLSET_MCP_ARGUMENTS_INVALID"),
    };
  }
  const method = typeof input.method === "string" ? input.method.toUpperCase() : "";
  if (method !== "GET" && method !== "POST" && method !== "PUT" && method !== "PATCH" && method !== "DELETE") {
    throw new GatewayStoreError("TOOLSET_METHOD_INVALID", 400);
  }
  return {
    method,
    path: textField(input.path, "toolset_path", 2000),
    query: recordField(input.query, "TOOLSET_QUERY_INVALID") as HttpToolsetRequest["query"],
    ...(input.body !== undefined ? { body: input.body } : {}),
  };
}

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}

async function sha256File(filename: string) {
  const hash = createHash("sha256");
  const stream = fs.createReadStream(filename);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

export function createGatewayApp(dependencies: AppDependencies) {
  const app = express();
  const startedAt = dependencies.startedAt || new Date();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_request, response) => {
    const quickCheck = dependencies.db.pragma("quick_check", { simple: true });
    const encryption = dependencies.store.encryptionStatus();
    const ok = quickCheck === "ok" && encryption.unreadableSecretCount === 0;
    response.status(ok ? 200 : 503).json({
      ok,
      service: "prism-gateway",
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
      database: {
        ok: quickCheck === "ok",
        migrations: dependencies.migrationCount,
      },
      catalog: dependencies.store.stats(),
      encryption,
      callersConfigured: dependencies.config.callers.map((caller) => caller.id),
    });
  });

  app.use(gatewayAuth(dependencies.config.callers));

  app.post("/ops/backup", requireSiteCaller, asyncRoute(async (_request, response) => {
    const backupDirectory = path.join(path.dirname(dependencies.config.dbPath), "backups");
    fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    const createdAt = new Date().toISOString();
    const stamp = createdAt.replace(/[:.]/g, "-");
    const filename = `prism-gateway-${stamp}.sqlite`;
    const backupPath = path.join(backupDirectory, filename);
    await dependencies.db.backup(backupPath);
    await fs.promises.chmod(backupPath, 0o600);
    const { size: bytes } = await fs.promises.stat(backupPath);
    const sha256 = await sha256File(backupPath);
    const encryption = dependencies.store.encryptionStatus();
    const manifest = {
      formatVersion: 1,
      createdAt,
      database: filename,
      bytes,
      sha256,
      currentKeyVersion: encryption.currentKeyVersion,
      encryptedSecretVersions: encryption.versions,
    };
    const manifestFilename = `${filename}.json`;
    const manifestPath = path.join(backupDirectory, manifestFilename);
    await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    response.json({ ok: true, backup: { ...manifest, manifest: manifestFilename, directory: "backups" } });
  }));

  app.post("/ops/rotate-master-key", requireSiteCaller, (_request, response) => {
    const result = dependencies.store.rotateEncryptionKey();
    response.json({ ok: true, rotation: result });
  });

  app.get("/connector-drivers", (_request, response) => {
    response.json({ ok: true, drivers: dependencies.store.listDrivers() });
  });

  app.get("/capabilities", (_request, response) => {
    response.json({ ok: true, capabilities: dependencies.store.listCapabilities() });
  });

  app.get("/toolsets", (_request, response) => {
    response.json({ ok: true, toolsets: dependencies.store.listToolsetProfiles() });
  });

  app.post("/toolsets", requireSiteCaller, (request, response) => {
    const body = request.body as Record<string, unknown>;
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
      throw new GatewayStoreError("TOOLSET_ENABLED_INVALID", 400);
    }
    const protocol = body.protocol === "openapi" || body.protocol === "mcp" || body.protocol === "http" || body.protocol === "adapter"
      ? body.protocol
      : null;
    if (!protocol) throw new GatewayStoreError("TOOLSET_PROTOCOL_INVALID", 400);
    const toolset = dependencies.store.createToolsetProfile({
      key: textField(body.key, "toolset_key", 120),
      connectionId: textField(body.connectionId, "connection_id", 120),
      protocol,
      discoveryUrl: textField(body.discoveryUrl, "discovery_url", 2000),
      auth: toolsetAuthField(body.auth ?? { type: "none" }),
      envBindings: envBindingsField(body.envBindings),
      description: textField(body.description, "description", 500),
      enabled: body.enabled !== false,
    });
    response.status(201).json({ ok: true, toolset });
  });

  app.patch("/toolsets/:key", requireSiteCaller, (request, response) => {
    const body = request.body as Record<string, unknown>;
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
      throw new GatewayStoreError("TOOLSET_ENABLED_INVALID", 400);
    }
    const toolset = dependencies.store.updateToolsetProfile(routeParam(request.params.key), {
      ...(body.description !== undefined ? { description: textField(body.description, "description", 500) } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.envBindings !== undefined ? { envBindings: envBindingsField(body.envBindings) } : {}),
    });
    response.json({ ok: true, toolset });
  });

  const relayToolset = async (request: Request, response: Response, describe: boolean) => {
    const traceId = randomUUID();
    const startedAt = Date.now();
    const key = routeParam(request.params.key);
    const profile = dependencies.store.getToolsetProfile(key);
    if (!profile) throw new GatewayStoreError("TOOLSET_NOT_FOUND", 404);
    if (!profile.enabled) throw new GatewayStoreError("TOOLSET_DISABLED", 409);
    if (profile.protocol === "adapter") throw new GatewayStoreError("TOOLSET_ADAPTER_NOT_INVOKABLE", 409);
    const connection = dependencies.store.getConnection(profile.connectionId);
    if (!connection || connection.status === "revoked") throw new GatewayStoreError("TOOLSET_CONNECTION_UNAVAILABLE", 409);
    const credentials = dependencies.store.getConnectionCredentials(connection.id);
    const relayRequest = describe ? undefined : toolsetRequestField(request.body, profile.protocol);
    const activeRequest = relayRequest!;
    const auditInput = describe
      ? { action: "describe" }
      : "tool" in activeRequest
        ? { action: "request", tool: activeRequest.tool }
        : { action: "request", method: activeRequest.method, path: activeRequest.path };
    try {
      const result = await (dependencies.executeToolset ?? executeToolsetRequest)(profile, credentials, relayRequest);
      dependencies.store.markConnectionUsed(connection.id, result.status >= 200 && result.status < 500);
      dependencies.store.recordInvocation({
        traceId, capabilityKey: `toolset:${key}`,
        caller: response.locals.gatewayCaller as GatewayCaller,
        context: invocationContext((request.body as Record<string, unknown> | undefined)?.context),
        status: "succeeded", policyDecision: "runtime_toolset_assigned",
        latencyMs: Date.now() - startedAt, inputSummary: auditInput,
        outputSummary: { downstreamStatus: result.status, responseBytes: result.responseBytes }, units: 1,
      });
      response.json({ ok: true, traceId, toolset: key, downstreamStatus: result.status, contentType: result.contentType, result: result.body });
    } catch (error) {
      if (error instanceof GatewayDriverError) {
        dependencies.store.recordInvocation({
          traceId, capabilityKey: `toolset:${key}`,
          caller: response.locals.gatewayCaller as GatewayCaller,
          context: invocationContext((request.body as Record<string, unknown> | undefined)?.context),
          status: "failed", policyDecision: "runtime_toolset_assigned",
          latencyMs: Date.now() - startedAt, errorCode: error.code,
          inputSummary: auditInput, outputSummary: null, units: 1,
        });
        response.status(error.retryable ? 502 : 400).json({ ok: false, traceId, error: { code: error.code, retryable: error.retryable } });
        return;
      }
      throw error;
    }
  };

  app.post("/toolsets/:key/describe", asyncRoute(async (request, response) => relayToolset(request, response, true)));
  app.post("/toolsets/:key/request", asyncRoute(async (request, response) => relayToolset(request, response, false)));

  app.post("/toolsets/lease", requireRuntimeCaller, (request, response) => {
    const body = request.body as Record<string, unknown>;
    const keys = Array.isArray(body.toolsets)
      ? Array.from(new Set(body.toolsets.filter((key): key is string => typeof key === "string" && /^[a-z][a-z0-9.-]{1,119}$/.test(key))))
      : [];
    if (!keys.length || keys.length > 20) throw new GatewayStoreError("TOOLSET_LEASE_KEYS_INVALID", 400);
    const context = invocationContext(body.context);
    const caller = response.locals.gatewayCaller as GatewayCaller;
    const env: Record<string, string> = {};
    const leased: string[] = [];
    for (const key of keys) {
      const profile = dependencies.store.getToolsetProfile(key);
      if (!profile || !profile.enabled) {
        throw new GatewayStoreError("TOOLSET_LEASE_PROFILE_UNAVAILABLE", 409);
      }
      if (profile.protocol !== "adapter") continue;
      const credentials = dependencies.store.getConnectionCredentials(profile.connectionId);
      for (const [envName, secretName] of Object.entries(profile.envBindings)) {
        const value = credentials[secretName];
        if (!value) throw new GatewayStoreError("TOOLSET_LEASE_SECRET_MISSING", 409);
        if (env[envName] !== undefined && env[envName] !== value) {
          throw new GatewayStoreError("TOOLSET_LEASE_ENV_COLLISION", 409);
        }
        env[envName] = value;
      }
      dependencies.store.recordInvocation({
        traceId: randomUUID(), capabilityKey: `toolset:${key}`, caller, context,
        status: "succeeded", policyDecision: "runtime_credential_lease",
        latencyMs: 0, inputSummary: { action: "lease" },
        outputSummary: { envNames: Object.keys(profile.envBindings).sort() }, units: 1,
      });
      dependencies.store.markConnectionLeased(profile.connectionId);
      leased.push(key);
    }
    response.json({ ok: true, env, leasedToolsets: leased });
  });

  app.post("/capabilities", requireSiteCaller, (request, response) => {
    const body = request.body as Record<string, unknown>;
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
      throw new GatewayStoreError("CAPABILITY_ENABLED_INVALID", 400);
    }
    const capability = dependencies.store.createCapability({
      key: textField(body.key, "capability_key", 120),
      driverKey: textField(body.driverKey, "driver_key", 120),
      connectionId: textField(body.connectionId, "connection_id", 120),
      provider: textField(body.provider, "provider", 120),
      description: textField(body.description, "description", 500),
      driverConfig: body.driverConfig,
      inputSchema: optionalSchema(body.inputSchema),
      outputSchema: optionalSchema(body.outputSchema),
      enabled: body.enabled !== false,
    });
    response.status(201).json({ ok: true, capability });
  });

  app.patch("/capabilities/:key", requireSiteCaller, (request, response) => {
    const body = request.body as Record<string, unknown>;
    const key = routeParam(request.params.key);
    if (
      body.enabled === undefined &&
      body.driverConfig === undefined &&
      body.description === undefined &&
      body.inputSchema === undefined &&
      body.outputSchema === undefined
    ) {
      throw new GatewayStoreError("CAPABILITY_UPDATE_REQUIRED", 400);
    }
    let capability = body.driverConfig === undefined
      ? dependencies.store.getCapability(key)
      : dependencies.store.updateCapabilityConfig(key, body.driverConfig);
    if (!capability) throw new GatewayStoreError("CAPABILITY_NOT_FOUND", 404);
    if (body.description !== undefined || body.inputSchema !== undefined || body.outputSchema !== undefined) {
      capability = dependencies.store.updateCapabilityMetadata(key, {
        ...(body.description !== undefined ? { description: textField(body.description, "description", 500) } : {}),
        ...(body.inputSchema !== undefined ? { inputSchema: optionalSchema(body.inputSchema) } : {}),
        ...(body.outputSchema !== undefined ? { outputSchema: optionalSchema(body.outputSchema) } : {}),
      });
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") throw new GatewayStoreError("CAPABILITY_ENABLED_INVALID", 400);
      capability = dependencies.store.setCapabilityEnabled(key, body.enabled);
    }
    response.json({ ok: true, capability });
  });

  app.post("/capabilities/:key/test", requireSiteCaller, asyncRoute(async (request, response) => {
    const body = request.body as Record<string, unknown>;
    const result = await dependencies.invoker.invoke({
      capabilityKey: routeParam(request.params.key),
      capabilityInput: recordField(body.input, "CAPABILITY_INPUT_INVALID"),
      context: invocationContext(body.context),
      caller: response.locals.gatewayCaller as GatewayCaller,
      adminTest: true,
    });
    response.status(result.status).json(result);
  }));

  app.get("/connections", requireSiteCaller, (_request, response) => {
    response.json({ ok: true, connections: dependencies.store.listConnections() });
  });

  app.get("/credentials", requireSiteCaller, (_request, response) => {
    response.json({ ok: true, credentials: dependencies.store.listStoredCredentials() });
  });

  app.post("/credentials/import", requireSiteCaller, (request, response) => {
    const body = request.body as Record<string, unknown>;
    const credentials = dependencies.store.upsertStoredCredentials(
      storedCredentialsField(body.credentials),
      "environment-import",
    );
    response.status(201).json({ ok: true, credentials });
  });

  app.post("/connections", requireSiteCaller, (request, response) => {
    const body = request.body as Record<string, unknown>;
    const connection = dependencies.store.createConnection({
      provider: textField(body.provider, "provider", 120),
      label: textField(body.label, "label", 200),
      authType: textField(body.authType, "auth_type", 80),
      credentials: credentialsField(body.credentials),
    });
    response.status(201).json({ ok: true, connection });
  });

  app.put("/connections/:id/credentials", requireSiteCaller, (request, response) => {
    const body = request.body as Record<string, unknown>;
    const connection = dependencies.store.replaceConnectionCredentials(
      routeParam(request.params.id),
      credentialsField(body.credentials),
    );
    response.json({ ok: true, connection });
  });

  app.put("/connections/:id/credentials/from-store", requireSiteCaller, (request, response) => {
    const body = request.body as Record<string, unknown>;
    const connection = dependencies.store.bindStoredCredentials(
      routeParam(request.params.id),
      storedCredentialBindingsField(body.bindings),
    );
    response.json({ ok: true, connection });
  });

  app.delete("/connections/:id", requireSiteCaller, (request, response) => {
    const connection = dependencies.store.revokeConnection(routeParam(request.params.id));
    response.json({ ok: true, connection });
  });

  app.get("/grants", requireSiteCaller, (_request, response) => {
    response.json({ ok: true, grants: dependencies.store.listGrants() });
  });

  app.put("/grants/:id", requireSiteCaller, (request, response) => {
    const body = request.body as Record<string, unknown>;
    const subjectType = body.subjectType === "runtime" || body.subjectType === "service"
      ? body.subjectType
      : null;
    if (!subjectType) throw new GatewayStoreError("GRANT_SUBJECT_TYPE_INVALID", 400);
    if (typeof body.allowed !== "boolean") throw new GatewayStoreError("GRANT_ALLOWED_INVALID", 400);
    const grant = dependencies.store.upsertGrant({
      id: routeParam(request.params.id),
      subjectType,
      subjectId: textField(body.subjectId, "grant_subject_id", 120),
      capabilityKey: textField(body.capabilityKey, "grant_capability_key", 120),
      allowed: body.allowed,
      policy: recordField(body.policy, "GRANT_POLICY_INVALID"),
    });
    response.json({ ok: true, grant });
  });

  app.post("/invoke", asyncRoute(async (request, response) => {
    const body = request.body as Record<string, unknown>;
    const result = await dependencies.invoker.invoke({
      capabilityKey: textField(body.capability, "capability", 120),
      capabilityInput: recordField(body.input, "CAPABILITY_INPUT_INVALID"),
      context: invocationContext(body.context),
      caller: response.locals.gatewayCaller as GatewayCaller,
    });
    response.status(result.status).json(result);
  }));

  app.get("/audit-events", requireSiteCaller, (request, response) => {
    const limit = Number.parseInt(String(request.query.limit || "100"), 10);
    response.json({
      ok: true,
      events: dependencies.store.listAuditEvents(Number.isFinite(limit) ? limit : 100),
    });
  });

  app.get("/audit-events/:traceId", requireSiteCaller, (request, response) => {
    const event = dependencies.store.getAuditEvent(routeParam(request.params.traceId));
    if (!event) throw new GatewayStoreError("AUDIT_EVENT_NOT_FOUND", 404);
    response.json({ ok: true, event });
  });

  app.use((_request, response) => {
    response.status(404).json({ ok: false, error: "GATEWAY_ROUTE_NOT_FOUND" });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof GatewayStoreError) {
      response.status(error.status).json({ ok: false, error: error.code });
      return;
    }
    if (error instanceof SyntaxError) {
      response.status(400).json({ ok: false, error: "GATEWAY_JSON_INVALID" });
      return;
    }
    console.error(JSON.stringify({ event: "prism-gateway.request_failed", error: "GATEWAY_INTERNAL_ERROR" }));
    response.status(500).json({ ok: false, error: "GATEWAY_INTERNAL_ERROR" });
  });

  return app;
}
