import { NextResponse } from "next/server";
import {
  gatewayCredentialPath,
  nextcrmGatewayPreset,
  nextcrmGatewayToolset,
  normalizeGatewayPresetOrigin,
  plausibleGatewayPreset,
  plausibleGatewayToolset,
} from "@/lib/gateway-presets";
import { requireServiceAccess } from "@/lib/internal-service";
import {
  getPrismGatewayOverview,
  prismGatewayRequest,
  PrismGatewayError,
} from "@/lib/prism-gateway";
import { publicUrlFromRequest } from "@/lib/public-url";

type GatewayConnection = { id?: unknown; label?: unknown; secretNames?: unknown };
type GatewayCapability = { key?: unknown; connectionId?: unknown; driverConfig?: unknown; enabled?: unknown };
type GatewayToolset = { key?: unknown; connectionId?: unknown; protocol?: unknown; discoveryUrl?: unknown; enabled?: unknown };

function text(value: unknown, maxLength = 200) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function configuredOrigin(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function credentialResponse(request: Request, connection: GatewayConnection, defaultSecretName: string) {
  const connectionId = typeof connection.id === "string" ? connection.id : "";
  const secretNames = Array.isArray(connection.secretNames)
    ? connection.secretNames.filter((entry): entry is string => typeof entry === "string")
    : [];
  const secretName = secretNames[0] || defaultSecretName;
  const credentialPath = connectionId ? gatewayCredentialPath({ connectionId, secretName }) : null;
  return {
    credentialPath,
    credentialUrl: credentialPath ? publicUrlFromRequest(request, credentialPath) : null,
  };
}

export async function POST(request: Request) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || body.credentials !== undefined || body.credential !== undefined || body.secretValue !== undefined) {
    return NextResponse.json({ ok: false, error: "GATEWAY_AGENT_CREDENTIALS_FORBIDDEN" }, { status: 400 });
  }
  const presetKey = text(body.preset, 80).toLowerCase();
  const preset = presetKey === plausibleGatewayPreset.key
    ? plausibleGatewayPreset
    : presetKey === nextcrmGatewayPreset.key
      ? nextcrmGatewayPreset
      : null;
  if (!preset) {
    return NextResponse.json({ ok: false, error: "GATEWAY_INTEGRATION_PRESET_UNSUPPORTED" }, { status: 400 });
  }
  const origin = normalizeGatewayPresetOrigin(body.origin);
  if (!origin) return NextResponse.json({ ok: false, error: "GATEWAY_INTEGRATION_ORIGIN_INVALID" }, { status: 400 });
  const label = text(body.label) || preset.defaultLabel;

  let pendingConnectionId = "";
  try {
    const overview = await getPrismGatewayOverview();
    const overviewRecord = overview as unknown as { capabilities?: unknown; connections?: unknown; toolsets?: unknown };
    const capabilities = Array.isArray(overviewRecord.capabilities) ? overviewRecord.capabilities as GatewayCapability[] : [];
    const connections = Array.isArray(overviewRecord.connections) ? overviewRecord.connections as GatewayConnection[] : [];
    const toolsets = Array.isArray(overviewRecord.toolsets)
      ? overviewRecord.toolsets as GatewayToolset[]
      : [];

    const toolsetKey = preset.toolsetKey;
    const existingToolset = toolsets.find((toolset) => toolset.key === toolsetKey);
    if (existingToolset) {
      const connection = connections.find((candidate) => candidate.id === existingToolset.connectionId) ?? {};
      const currentOrigin = configuredOrigin(existingToolset.discoveryUrl);
      return NextResponse.json({
        ok: true,
        existing: true,
        preset: preset.key,
        connection,
        toolset: existingToolset,
        ...credentialResponse(request, connection, preset.secretName),
        requestedOrigin: origin,
        configuredOrigin: currentOrigin,
        requiresReview: Boolean(currentOrigin && currentOrigin !== origin),
        nextStep: existingToolset.enabled === true
          ? "The integration already exists and is enabled."
          : "Add or replace the credential in Settings, then enable the access profile.",
      });
    }

    const legacyCapability = capabilities.find((capability) => capability.key === preset.capabilityKey);
    let connection = connections.find((candidate) => candidate.id === legacyCapability?.connectionId) ?? null;
    if (!connection) {
      const connectionResult = await prismGatewayRequest<{ connection?: GatewayConnection }>("/connections", {
        method: "POST",
        body: JSON.stringify({ provider: preset.provider, label, authType: preset.authType, credentials: {} }),
      });
      connection = connectionResult.connection ?? null;
      pendingConnectionId = typeof connection?.id === "string" ? connection.id : "";
    }
    const connectionId = typeof connection?.id === "string" ? connection.id : "";
    if (!connectionId) throw new PrismGatewayError("GATEWAY_CONNECTION_RESPONSE_INVALID", 502);
    const activeConnection: GatewayConnection = connection ?? { id: connectionId };
    const toolset = preset.key === plausibleGatewayPreset.key
      ? plausibleGatewayToolset({ connectionId, origin, enabled: false })
      : nextcrmGatewayToolset({ connectionId, origin, enabled: false });
    const toolsetResult = await prismGatewayRequest("/toolsets", {
      method: "POST",
      body: JSON.stringify(toolset),
    });
    return NextResponse.json({
      ok: true,
      existing: false,
      migratedFromCapability: Boolean(legacyCapability),
      preset: preset.key,
      connection: activeConnection,
      toolset: toolsetResult.toolset ?? null,
      ...credentialResponse(request, activeConnection, preset.secretName),
      nextStep: "Add or replace the credential in Settings, then enable the access profile.",
    }, { status: 201 });
  } catch (error) {
    if (pendingConnectionId) {
      await prismGatewayRequest(`/connections/${encodeURIComponent(pendingConnectionId)}`, { method: "DELETE" }).catch(() => null);
    }
    const status = error instanceof PrismGatewayError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "GATEWAY_INTEGRATION_CREATE_FAILED" }, { status });
  }
}
