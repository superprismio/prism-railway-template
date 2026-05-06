import { NextResponse } from "next/server"

import { createUserInvite } from "@/lib/app-core"
import { requireCapabilityAccess } from "@/lib/admin-auth"
import { parseString } from "@/lib/local-admin-api"
import { publicUrlFromRequest } from "@/lib/public-url"

function claimUrl(request: Request, token: string) {
  return publicUrlFromRequest(request, `/claim?token=${encodeURIComponent(token)}`)
}

export async function POST(request: Request) {
  const access = await requireCapabilityAccess("canManageUsers")
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const userId = parseString(body?.userId ?? body?.user_id)
  const kind = parseString(body?.kind) === "reset" ? "reset" : "invite"

  if (!userId) {
    return NextResponse.json({ ok: false, error: "User id is required" }, { status: 400 })
  }

  try {
    const invite = createUserInvite({
      userId,
      kind,
      createdByUserId: access.userId,
    })
    return NextResponse.json({
      ok: true,
      invite: {
        id: invite.id,
        userId: invite.userId,
        kind: invite.kind,
        expiresAt: invite.expiresAt,
        claimUrl: claimUrl(request, invite.token),
      },
    }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create invite"
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
