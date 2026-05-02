import { NextResponse } from "next/server"
import {
  buildTargetEnvironmentDeployPlan,
  getNextQueuedChangeRequest,
  getTargetApp,
  getTargetEnvironment,
  listChangeRequestExecutions,
} from "@/lib/app-core"

import { requireServiceAccess } from "@/lib/internal-service"

export async function GET(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const targetAppId = new URL(request.url).searchParams.get("targetAppId") ?? undefined
  const changeRequest = getNextQueuedChangeRequest({ targetAppId })

  if (!changeRequest) {
    return NextResponse.json({ ok: true, changeRequest: null, targetApp: null, targetEnvironment: null, deployPlan: null, latestExecution: null })
  }

  const targetApp = changeRequest.targetAppId ? getTargetApp(changeRequest.targetAppId) : null
  const targetEnvironment = changeRequest.targetEnvironmentId ? getTargetEnvironment(changeRequest.targetEnvironmentId) : null
  const latestExecution = listChangeRequestExecutions(changeRequest.id)[0] ?? null
  const deployPlan = targetApp && targetEnvironment
    ? buildTargetEnvironmentDeployPlan({ request: changeRequest, targetApp, targetEnvironment })
    : null

  return NextResponse.json({ ok: true, changeRequest, targetApp, targetEnvironment, deployPlan, latestExecution })
}
