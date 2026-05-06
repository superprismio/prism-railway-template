import { NextResponse } from "next/server"

import {
  createAdminManagedUser,
  createUserInvite,
  listAdminUsers,
  setUserRoleSlugs,
} from "@/lib/app-core"
import { requireCapabilityAccess } from "@/lib/admin-auth"
import { publicUrlFromRequest } from "@/lib/public-url"
import { normalizeRoleSlugs } from "@/lib/role-access"

function parseString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function parseRoleSlugs(value: unknown) {
  return Array.isArray(value)
    ? normalizeRoleSlugs(value.filter((role): role is string => typeof role === "string"))
    : []
}

function claimUrl(request: Request, token: string) {
  return publicUrlFromRequest(request, `/claim?token=${encodeURIComponent(token)}`)
}

export async function GET() {
  const access = await requireCapabilityAccess("canManageUsers")
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  return NextResponse.json({ ok: true, users: listAdminUsers(200) })
}

export async function POST(request: Request) {
  const access = await requireCapabilityAccess("canManageUsers")
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const email = parseString(body?.email).toLowerCase()
  const displayName = parseString(body?.displayName ?? body?.display_name)
  const roleSlugs = parseRoleSlugs(body?.roleSlugs ?? body?.role_slugs)

  if (!email) {
    return NextResponse.json({ ok: false, error: "Email is required" }, { status: 400 })
  }

  try {
    const user = createAdminManagedUser({
      email,
      displayName: displayName || null,
      roleSlugs: roleSlugs.length ? roleSlugs : ["member"],
    })
    if (!user) {
      return NextResponse.json({ ok: false, error: "Could not create member" }, { status: 500 })
    }
    const invite = createUserInvite({
      userId: user.id,
      kind: "invite",
      createdByUserId: access.userId,
    })
    return NextResponse.json({
      ok: true,
      user,
      invite: {
        id: invite.id,
        userId: invite.userId,
        kind: invite.kind,
        expiresAt: invite.expiresAt,
        claimUrl: claimUrl(request, invite.token),
      },
    }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create member"
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  const access = await requireCapabilityAccess("canManageUsers")
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const userId = parseString(body?.userId ?? body?.user_id)
  const roleSlugs = parseRoleSlugs(body?.roleSlugs ?? body?.role_slugs)

  if (!userId) {
    return NextResponse.json({ ok: false, error: "User id is required" }, { status: 400 })
  }

  if (access.userId && userId === access.userId) {
    return NextResponse.json({ ok: false, error: "You cannot change your own roles in this slice" }, { status: 400 })
  }

  if (!roleSlugs.length) {
    return NextResponse.json({ ok: false, error: "At least one role is required" }, { status: 400 })
  }

  try {
    const user = setUserRoleSlugs(userId, roleSlugs)
    return NextResponse.json({ ok: true, user })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update member roles"
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
