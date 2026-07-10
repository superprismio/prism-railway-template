import { NextResponse } from "next/server";
import { requireServiceAccess } from "@/lib/internal-service";
import { PrismGatewayError, prismGatewayRequest } from "@/lib/prism-gateway";

export async function GET() {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  try {
    return NextResponse.json(await prismGatewayRequest("/toolsets"));
  } catch (error) {
    const status = error instanceof PrismGatewayError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "TOOLSET_LIST_FAILED" }, { status });
  }
}

export async function POST(request: Request) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "INVALID_JSON_BODY" }, { status: 400 });
  if (body.credentials !== undefined || body.credential !== undefined || body.secretValue !== undefined) {
    return NextResponse.json({ ok: false, error: "GATEWAY_AGENT_CREDENTIALS_FORBIDDEN" }, { status: 400 });
  }
  try {
    return NextResponse.json(await prismGatewayRequest("/toolsets", {
      method: "POST",
      body: JSON.stringify({ ...body, enabled: false }),
    }));
  } catch (error) {
    const status = error instanceof PrismGatewayError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "TOOLSET_CREATE_FAILED" }, { status });
  }
}
