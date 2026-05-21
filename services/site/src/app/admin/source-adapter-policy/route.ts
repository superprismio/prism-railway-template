import { NextResponse } from "next/server"

import { loadConfig, readSourceAdapterPolicy, writeSourceAdapterPolicy } from "@/lib/app-core"
import { requireCapabilityAccess } from "@/lib/admin-auth"

function readPolicyPayload(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null
  }
  const record = body as Record<string, unknown>
  const policy = record.policy ?? record
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return null
  }
  const policyRecord = policy as Record<string, unknown>
  return policyRecord.platforms && typeof policyRecord.platforms === "object" && !Array.isArray(policyRecord.platforms)
    ? policyRecord
    : null
}

export async function GET() {
  const access = await requireCapabilityAccess("canManageSettings")
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  return NextResponse.json({ ok: true, policy: readSourceAdapterPolicy(loadConfig()) })
}

export async function PATCH(request: Request) {
  const access = await requireCapabilityAccess("canManageSettings")
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const policy = readPolicyPayload(await request.json().catch(() => null))
  if (!policy) {
    return NextResponse.json({ ok: false, error: "Invalid source adapter policy payload" }, { status: 400 })
  }

  return NextResponse.json({ ok: true, policy: writeSourceAdapterPolicy(loadConfig(), policy) })
}
