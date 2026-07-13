import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { prismGatewayRequest, PrismGatewayError } from "@/lib/prism-gateway";

type RouteContext = { params: Promise<{ key: string }> };

export async function POST(request: Request, context: RouteContext) {
  const access = await requireAdminAccess();
  if (!access.ok)
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  const body = await request.json().catch(() => ({}));
  const { key } = await context.params;
  try {
    return NextResponse.json(
      await prismGatewayRequest(
        `/capabilities/${encodeURIComponent(key)}/test`,
        { method: "POST", body: JSON.stringify(body) },
      ),
    );
  } catch (error) {
    const status = error instanceof PrismGatewayError ? error.status : 500;
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "CAPABILITY_TEST_FAILED",
      },
      { status },
    );
  }
}
