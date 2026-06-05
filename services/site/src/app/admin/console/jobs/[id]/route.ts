import { NextResponse } from "next/server"

import { getAgentRun, getAgentResponseJob } from "@/lib/app-core"
import { requireLocalAdminAccess } from "@/lib/local-admin-api"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id } = await params
  const agentRun = getAgentRun(id)
  if (agentRun) {
    const outputText =
      typeof agentRun.result.output_text === "string"
        ? agentRun.result.output_text
        : typeof agentRun.result.outputText === "string"
          ? agentRun.result.outputText
          : null
    return NextResponse.json({
      ok: true,
      agentRun,
      job: {
        id: agentRun.id,
        status: agentRun.status,
        sessionId: agentRun.sessionId,
        outputText,
        errorMessage: agentRun.errorMessage,
        trace: agentRun.trace,
        startedAt: agentRun.startedAt,
        finishedAt: agentRun.finishedAt,
      },
    })
  }

  const job = getAgentResponseJob(id)
  if (!job) {
    return NextResponse.json({ ok: false, error: "Console job not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, job })
}
