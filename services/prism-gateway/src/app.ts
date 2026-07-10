import type Database from "better-sqlite3";
import express, { type NextFunction, type Request, type Response } from "express";
import { gatewayAuth, requireSiteCaller } from "./auth.js";
import { GatewayInvoker } from "./invoke.js";
import { GatewayStore, GatewayStoreError } from "./store.js";
import type { GatewayCaller, GatewayConfig, GatewayInvocationContext } from "./types.js";

type AppDependencies = {
  config: GatewayConfig;
  db: Database.Database;
  store: GatewayStore;
  invoker: GatewayInvoker;
  migrationCount: number;
  startedAt?: Date;
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

function optionalSchema(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new GatewayStoreError("CAPABILITY_SCHEMA_INVALID", 400);
  }
  return value as Record<string, unknown>;
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

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}

export function createGatewayApp(dependencies: AppDependencies) {
  const app = express();
  const startedAt = dependencies.startedAt || new Date();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_request, response) => {
    const quickCheck = dependencies.db.pragma("quick_check", { simple: true });
    response.json({
      ok: quickCheck === "ok",
      service: "prism-gateway",
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
      database: {
        ok: quickCheck === "ok",
        migrations: dependencies.migrationCount,
      },
      catalog: dependencies.store.stats(),
      callersConfigured: dependencies.config.callers.map((caller) => caller.id),
    });
  });

  app.use(gatewayAuth(dependencies.config.callers));

  app.get("/connector-drivers", (_request, response) => {
    response.json({ ok: true, drivers: dependencies.store.listDrivers() });
  });

  app.get("/capabilities", (_request, response) => {
    response.json({ ok: true, capabilities: dependencies.store.listCapabilities() });
  });

  app.post("/capabilities", requireSiteCaller, (request, response) => {
    const body = request.body as Record<string, unknown>;
    const capability = dependencies.store.createCapability({
      key: textField(body.key, "capability_key", 120),
      driverKey: textField(body.driverKey, "driver_key", 120),
      connectionId: textField(body.connectionId, "connection_id", 120),
      provider: textField(body.provider, "provider", 120),
      description: textField(body.description, "description", 500),
      driverConfig: body.driverConfig,
      inputSchema: optionalSchema(body.inputSchema),
      outputSchema: optionalSchema(body.outputSchema),
    });
    response.status(201).json({ ok: true, capability });
  });

  app.patch("/capabilities/:key", requireSiteCaller, (request, response) => {
    const body = request.body as Record<string, unknown>;
    if (typeof body.enabled !== "boolean") throw new GatewayStoreError("CAPABILITY_ENABLED_INVALID", 400);
    const capability = dependencies.store.setCapabilityEnabled(routeParam(request.params.key), body.enabled);
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
