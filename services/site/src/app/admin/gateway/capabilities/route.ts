import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { prismGatewayRequest, PrismGatewayError } from "@/lib/prism-gateway";

export async function POST(request: Request) {
  const access = await requireAdminAccess();
  if (!access.ok)
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  try {
    const created = await prismGatewayRequest<{ capability?: { key?: unknown }; [key: string]: unknown }>(
      "/capabilities",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    const capabilityKey = typeof created.capability?.key === "string"
      ? created.capability.key
      : "";
    if (!capabilityKey) return NextResponse.json(created);

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
      return NextResponse.json({ ...created, defaultRuntimeGrant: grant.grant ?? null });
    } catch (grantError) {
      console.warn(JSON.stringify({
        event: "prism_gateway.default_runtime_grant_failed",
        capabilityKey,
        runtimeKey,
        error: grantError instanceof Error ? grantError.message : "GATEWAY_GRANT_FAILED",
      }));
      return NextResponse.json({
        ...created,
        warning: "CAPABILITY_CREATED_DEFAULT_RUNTIME_GRANT_FAILED",
      });
    }
  } catch (error) {
    const status = error instanceof PrismGatewayError ? error.status : 500;
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "CAPABILITY_CREATE_FAILED",
      },
      { status },
    );
  }
}
