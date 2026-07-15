import "server-only";
import {
  interactiveGatewayCapabilities,
  interactiveGatewayCapabilityKeys,
  type GatewayCapabilityDescriptor,
  type GatewayCapabilitySummary,
  type InteractiveGatewayMode,
} from "@/lib/prism-gateway-policy";

export class PrismGatewayError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function gatewayEnabled() {
  return process.env.PRISM_GATEWAY_ENABLED?.trim().toLowerCase() === "true";
}

function gatewayBaseUrl() {
  return process.env.PRISM_GATEWAY_BASE_URL?.trim().replace(/\/+$/, "") || "";
}

function gatewayToken() {
  return process.env.PRISM_GATEWAY_TOKEN?.trim() || "";
}

export function getPrismGatewayStatus() {
  return {
    enabled: gatewayEnabled(),
    configured: Boolean(gatewayBaseUrl() && gatewayToken()),
  };
}

export async function listInteractiveGatewayCapabilityKeys(mode: InteractiveGatewayMode) {
  if (mode === "off") return [];
  const payload = await prismGatewayRequest<{ capabilities?: GatewayCapabilitySummary[] }>("/capabilities");
  return interactiveGatewayCapabilityKeys(payload.capabilities ?? [], mode);
}

export async function listInteractiveGatewayCapabilities(mode: InteractiveGatewayMode) {
  if (mode === "off") return [];
  const payload = await prismGatewayRequest<{ capabilities?: GatewayCapabilitySummary[] }>("/capabilities");
  return interactiveGatewayCapabilities(payload.capabilities ?? [], mode);
}

export async function listInteractiveGatewayCapabilityKeysOrEmpty(mode: InteractiveGatewayMode) {
  const status = getPrismGatewayStatus();
  if (!status.enabled || !status.configured || mode === "off") return [];
  try {
    return await listInteractiveGatewayCapabilityKeys(mode);
  } catch (error) {
    console.warn(JSON.stringify({
      event: "prism_gateway.interactive_catalog_unavailable",
      mode,
      error: error instanceof Error ? error.message : "PRISM_GATEWAY_CATALOG_FAILED",
    }));
    return [];
  }
}

export async function listInteractiveGatewayCapabilitiesOrEmpty(
  mode: InteractiveGatewayMode,
): Promise<GatewayCapabilityDescriptor[]> {
  const status = getPrismGatewayStatus();
  if (!status.enabled || !status.configured || mode === "off") return [];
  try {
    return await listInteractiveGatewayCapabilities(mode);
  } catch (error) {
    console.warn(JSON.stringify({
      event: "prism_gateway.interactive_catalog_unavailable",
      mode,
      error: error instanceof Error ? error.message : "PRISM_GATEWAY_CATALOG_FAILED",
    }));
    return [];
  }
}

export async function listEnabledGatewayCredentialsOrEmpty(): Promise<Array<{
  key: string;
}>> {
  const status = getPrismGatewayStatus();
  if (!status.enabled || !status.configured) return [];
  try {
    const payload = await prismGatewayRequest<{
      credentials?: Array<{ key?: unknown; status?: unknown }>;
    }>("/credential-bundles");
    return (payload.credentials ?? []).flatMap((credential) => {
      if (
        typeof credential.key !== "string"
        || credential.key.length === 0
        || credential.status === "revoked"
      ) return [];
      return [{
        key: credential.key,
      }];
    });
  } catch (error) {
    console.warn(JSON.stringify({
      event: "prism_gateway.credential_catalog_unavailable",
      error: error instanceof Error ? error.message : "PRISM_GATEWAY_CREDENTIAL_CATALOG_FAILED",
    }));
    return [];
  }
}

export async function prismGatewayRequest<T = Record<string, unknown>>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const status = getPrismGatewayStatus();
  if (!status.enabled)
    throw new PrismGatewayError("PRISM_GATEWAY_DISABLED", 503);
  const baseUrl = gatewayBaseUrl();
  const token = gatewayToken();
  if (!baseUrl || !token)
    throw new PrismGatewayError("PRISM_GATEWAY_NOT_CONFIGURED", 503);
  if (!path.startsWith("/") || path.includes("://")) {
    throw new PrismGatewayError("PRISM_GATEWAY_PATH_INVALID", 400);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-gateway-token": token,
        ...init.headers,
      },
    });
  } catch {
    throw new PrismGatewayError("PRISM_GATEWAY_UNREACHABLE", 502);
  }

  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new PrismGatewayError("PRISM_GATEWAY_RESPONSE_INVALID", 502);
  }
  if (!response.ok || body.ok === false) {
    throw new PrismGatewayError(
      typeof body.error === "string"
        ? body.error
        : `PRISM_GATEWAY_HTTP_${response.status}`,
      response.status,
    );
  }
  return body as T;
}

export async function createGatewayCapabilityWithDefaultGrant(
  body: Record<string, unknown>,
) {
  const created = await prismGatewayRequest<{ capability?: { key?: unknown }; [key: string]: unknown }>(
    "/capabilities",
    { method: "POST", body: JSON.stringify(body) },
  );
  const capabilityKey = typeof created.capability?.key === "string"
    ? created.capability.key
    : "";
  if (!capabilityKey) return created;

  const runtimeKey = process.env.PRISM_GATEWAY_DEFAULT_RUNTIME_KEY?.trim() || "codex-default";
  const grantId = `runtime-${runtimeKey}-${capabilityKey}`.replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 200);
  try {
    const grant = await prismGatewayRequest(`/grants/${encodeURIComponent(grantId)}`, {
      method: "PUT",
      body: JSON.stringify({
        subjectType: "runtime",
        subjectId: runtimeKey,
        capabilityKey,
        allowed: true,
        policy: { source: "site-easy-mode" },
      }),
    });
    return { ...created, defaultRuntimeGrant: grant.grant ?? null };
  } catch (error) {
    console.warn(JSON.stringify({
      event: "prism_gateway.default_runtime_grant_failed",
      capabilityKey,
      runtimeKey,
      error: error instanceof Error ? error.message : "GATEWAY_GRANT_FAILED",
    }));
    return { ...created, warning: "CAPABILITY_CREATED_DEFAULT_RUNTIME_GRANT_FAILED" };
  }
}

export async function getPrismGatewayOverview() {
  const status = getPrismGatewayStatus();
  if (!status.enabled || !status.configured) {
    return { ...status, reachable: false };
  }

  const [health, drivers, credentials, connections, capabilities, grants, audit] =
    await Promise.all([
      prismGatewayRequest("/health"),
      prismGatewayRequest("/connector-drivers"),
      prismGatewayRequest("/credentials"),
      prismGatewayRequest("/connections"),
      prismGatewayRequest("/capabilities"),
      prismGatewayRequest("/grants"),
      prismGatewayRequest("/audit-events?limit=50"),
    ]);

  return {
    ...status,
    reachable: true,
    health,
    drivers: drivers.drivers ?? [],
    credentials: credentials.credentials ?? [],
    connections: connections.connections ?? [],
    capabilities: capabilities.capabilities ?? [],
    grants: grants.grants ?? [],
    auditEvents: audit.events ?? [],
  };
}
