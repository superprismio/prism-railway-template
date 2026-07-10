import { NextResponse } from "next/server";
import {
  gatewayCredentialPath,
  nextcrmContactReadCapability,
  nextcrmGatewayPreset,
  normalizeGatewayPresetOrigin,
  plausibleGatewayCapability,
  plausibleGatewayPreset,
} from "@/lib/gateway-presets";
import { requireServiceAccess } from "@/lib/internal-service";
import {
  createGatewayCapabilityWithDefaultGrant,
  getPrismGatewayOverview,
  prismGatewayRequest,
  PrismGatewayError,
} from "@/lib/prism-gateway";
import { publicUrlFromRequest } from "@/lib/public-url";

type GatewayConnection = { id?: unknown; label?: unknown; secretNames?: unknown };
type GatewayCapability = { key?: unknown; connectionId?: unknown; driverConfig?: unknown; enabled?: unknown };

function text(value: unknown, maxLength = 200) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
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
    const overviewRecord = overview as { capabilities?: unknown; connections?: unknown };
    const capabilities = Array.isArray(overviewRecord.capabilities) ? overviewRecord.capabilities as GatewayCapability[] : [];
    const connections = Array.isArray(overviewRecord.connections) ? overviewRecord.connections as GatewayConnection[] : [];
    const existingCapability = capabilities.find((capability) => capability.key === preset.capabilityKey);
    if (existingCapability) {
      const connection = connections.find((candidate) => candidate.id === existingCapability.connectionId) ?? {};
      const driverConfig = existingCapability.driverConfig && typeof existingCapability.driverConfig === "object" && !Array.isArray(existingCapability.driverConfig)
        ? existingCapability.driverConfig as Record<string, unknown>
        : {};
      const configuredOrigin = typeof driverConfig.baseUrl === "string" ? driverConfig.baseUrl : null;
      return NextResponse.json({
        ok: true,
        existing: true,
        preset: preset.key,
        connection,
        capability: existingCapability,
        ...credentialResponse(request, connection, preset.secretName),
        requestedOrigin: origin,
        configuredOrigin,
        requiresReview: Boolean(configuredOrigin && configuredOrigin !== origin),
        nextStep: existingCapability.enabled === true
          ? "The integration already exists and is enabled. Test it before changing configuration."
          : "Add or replace the credential in Settings, then test and enable the capability.",
      });
    }

    const connectionResult = await prismGatewayRequest<{ connection?: GatewayConnection }>("/connections", {
      method: "POST",
      body: JSON.stringify({
        provider: preset.provider,
        label,
        authType: preset.authType,
        credentials: {},
      }),
    });
    const connection = connectionResult.connection ?? {};
    pendingConnectionId = typeof connection.id === "string" ? connection.id : "";
    if (!pendingConnectionId) throw new PrismGatewayError("GATEWAY_CONNECTION_RESPONSE_INVALID", 502);

    const capability = preset.key === plausibleGatewayPreset.key
      ? plausibleGatewayCapability({ connectionId: pendingConnectionId, origin })
      : nextcrmContactReadCapability({ connectionId: pendingConnectionId, origin });
    const capabilityResult = await createGatewayCapabilityWithDefaultGrant(capability);
    return NextResponse.json({
      ok: true,
      existing: false,
      preset: preset.key,
      connection,
      capability: capabilityResult.capability ?? null,
      defaultRuntimeGrant: capabilityResult.defaultRuntimeGrant ?? null,
      warning: capabilityResult.warning ?? null,
      ...credentialResponse(request, connection, preset.secretName),
      nextStep: "Add the credential in Settings, then test representative input and enable the capability.",
    }, { status: 201 });
  } catch (error) {
    if (pendingConnectionId) {
      await prismGatewayRequest(`/connections/${encodeURIComponent(pendingConnectionId)}`, { method: "DELETE" }).catch(() => null);
    }
    const status = error instanceof PrismGatewayError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "GATEWAY_INTEGRATION_CREATE_FAILED" }, { status });
  }
}
