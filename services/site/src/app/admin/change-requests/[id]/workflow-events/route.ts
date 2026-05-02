import { NextResponse } from "next/server";

import { getChangeRequest, listWorkflowEventsForRequest } from "@/lib/app-core";
import { adminFetch } from "@/lib/admin";
import { readRouteParam, requireLocalAdminAccess, useLocalAppApi } from "@/lib/local-admin-api";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  if (useLocalAppApi()) {
    const access = await requireLocalAdminAccess();
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
    }

    const requestId = readRouteParam(id);
    const changeRequest = getChangeRequest(requestId);
    if (!changeRequest) {
      return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      events: listWorkflowEventsForRequest(requestId, 150),
    });
  }

  const response = await adminFetch(`/api/admin/change-board/requests/${id}/workflow-events`);
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "application/json";

  return new NextResponse(text, {
    status: response.status,
    headers: {
      "content-type": contentType,
    },
  });
}
