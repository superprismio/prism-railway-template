import { NextResponse } from "next/server"
import { buildTargetEnvironmentDeployPlan, getChangeRequest, getTargetApp, getTargetEnvironment } from "@/lib/app-core"

import { requireServiceAccess } from "@/lib/internal-service"
import { readRouteParam } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id } = await context.params
  const changeRequest = getChangeRequest(readRouteParam(id))
  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }
  if (!changeRequest.targetEnvironmentId) {
    return NextResponse.json({ ok: false, error: "Change request is missing a target environment" }, { status: 400 })
  }

  const targetEnvironment = getTargetEnvironment(changeRequest.targetEnvironmentId)
  if (!targetEnvironment) {
    return NextResponse.json({ ok: false, error: "Target environment not found" }, { status: 404 })
  }

  if (!changeRequest.targetAppId) {
    return NextResponse.json({ ok: false, error: "Request has no target app" }, { status: 400 })
  }
  const targetApp = getTargetApp(changeRequest.targetAppId)
  if (!targetApp) {
    return NextResponse.json({ ok: false, error: "Target app not found" }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    deployPlan: buildTargetEnvironmentDeployPlan({ request: changeRequest, targetApp, targetEnvironment }),
  })
}
