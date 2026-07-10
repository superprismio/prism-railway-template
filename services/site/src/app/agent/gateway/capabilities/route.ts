import { NextResponse } from "next/server";
import { requireServiceAccess } from "@/lib/internal-service";
import {
  createGatewayCapabilityWithDefaultGrant,
  prismGatewayRequest,
  PrismGatewayError,
} from "@/lib/prism-gateway";

export async function POST(request: Request) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "INVALID_JSON_BODY" }, { status: 400 });
  if (body.credentials !== undefined || body.credential !== undefined || body.secretValue !== undefined) {
    return NextResponse.json({ ok: false, error: "GATEWAY_AGENT_CREDENTIALS_FORBIDDEN" }, { status: 400 });
  }
  try {
    const enabled = body.enabled === true;
    const { enabled: _enabled, ...createBody } = body;
    const created = await createGatewayCapabilityWithDefaultGrant(createBody);
    const capabilityKey = created.capability && typeof created.capability === "object" && !Array.isArray(created.capability)
      && typeof (created.capability as Record<string, unknown>).key === "string"
      ? String((created.capability as Record<string, unknown>).key)
      : "";
    if (!enabled && capabilityKey) {
      const disabled = await prismGatewayRequest(`/capabilities/${encodeURIComponent(capabilityKey)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      });
      return NextResponse.json({ ...created, capability: disabled.capability ?? created.capability });
    }
    return NextResponse.json(created);
  } catch (error) {
    const status = error instanceof PrismGatewayError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "CAPABILITY_CREATE_FAILED" }, { status });
  }
}
