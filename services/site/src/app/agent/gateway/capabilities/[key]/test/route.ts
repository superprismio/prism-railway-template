import { NextResponse } from "next/server";
import { requireServiceAccess } from "@/lib/internal-service";
import { prismGatewayRequest, PrismGatewayError } from "@/lib/prism-gateway";

type RouteContext = { params: Promise<{ key: string }> };

export async function POST(request: Request, context: RouteContext) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !body.input || typeof body.input !== "object" || Array.isArray(body.input)) {
    return NextResponse.json({ ok: false, error: "CAPABILITY_TEST_INPUT_REQUIRED" }, { status: 400 });
  }
  const { key } = await context.params;
  try {
    return NextResponse.json(await prismGatewayRequest(`/capabilities/${encodeURIComponent(key)}/test`, {
      method: "POST",
      body: JSON.stringify({ input: body.input, context: body.context ?? {} }),
    }));
  } catch (error) {
    const status = error instanceof PrismGatewayError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "CAPABILITY_TEST_FAILED" }, { status });
  }
}
