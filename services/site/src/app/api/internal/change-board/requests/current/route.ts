import { NextResponse } from "next/server"
import {
  buildTargetEnvironmentDeployPlan,
  getCurrentActiveChangeRequest,
  getTargetApp,
  getTargetEnvironment,
  listChangeRequestExecutions,
} from "@prism-railway/app-core"

import { requireServiceAccess } from "@/lib/internal-service"

export async function GET(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const targetAppId = new URL(request.url).searchParams.get("targetAppId") ?? undefined
  const changeRequest = getCurrentActiveChangeRequest({ targetAppId })

  if (!changeRequest) {
    return NextResponse.json({ ok: true, changeRequest: null, targetApp: null, targetEnvironment: null, deployPlan: null, latestExecution: null })
  }

  const targetApp = getTargetApp(changeRequest.targetAppId)
  const targetEnvironment = changeRequest.targetEnvironmentId ? getTargetEnvironment(changeRequest.targetEnvironmentId) : null
  const latestExecution = listChangeRequestExecutions(changeRequest.id)[0] ?? null
  const deployPlan = targetApp && targetEnvironment
    ? buildTargetEnvironmentDeployPlan({ request: changeRequest, targetApp, targetEnvironment })
    : null

  return NextResponse.json({ ok: true, changeRequest, targetApp, targetEnvironment, deployPlan, latestExecution })
}
