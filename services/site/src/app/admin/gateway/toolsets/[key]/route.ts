import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { PrismGatewayError, prismGatewayRequest } from "@/lib/prism-gateway";

export async function PATCH(request: Request, context: { params: Promise<{ key: string }> }) {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  const { key } = await context.params;
  try {
    return NextResponse.json(await prismGatewayRequest(`/toolsets/${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }));
  } catch (error) {
    const status = error instanceof PrismGatewayError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "TOOLSET_UPDATE_FAILED" }, { status });
  }
}
