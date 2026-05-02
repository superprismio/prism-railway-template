import { NextResponse } from "next/server";

import { listWorkflows } from "@/lib/app-core";
import { requireLocalAdminAccess } from "@/lib/local-admin-api";

export async function GET() {
  const access = await requireLocalAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  return NextResponse.json({ ok: true, workflows: listWorkflows() });
}
