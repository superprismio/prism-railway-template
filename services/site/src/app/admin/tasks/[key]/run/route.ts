import { NextResponse } from "next/server";

import { requireLocalAdminAccess } from "@/lib/local-admin-api";

function taskRunnerBaseUrl() {
  return (process.env.TASK_RUNNER_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

function taskRunnerToken() {
  return (process.env.TASK_RUNNER_TOKEN ?? process.env.INTERNAL_SERVICE_TOKEN ?? "").trim();
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const access = await requireLocalAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const baseUrl = taskRunnerBaseUrl();
  if (!baseUrl) {
    return NextResponse.json(
      { ok: false, error: "TASK_RUNNER_BASE_URL is not configured on the site service" },
      { status: 503 },
    );
  }

  const { key } = await params;
  const response = await fetch(`${baseUrl}/tasks/${encodeURIComponent(key)}/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(taskRunnerToken() ? { "x-task-runner-token": taskRunnerToken() } : {}),
    },
    body: JSON.stringify({ source: "admin" }),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  return NextResponse.json(payload, { status: response.status });
}
