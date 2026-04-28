import { NextResponse } from "next/server"
import { upsertAgentSessionFromDiscord } from "@/lib/app-core"

import { parseNullableString, parseString, requireServiceAccess } from "@/lib/internal-service"

export async function POST(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  let payload: unknown = null
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {}
  const session = upsertAgentSessionFromDiscord({
    source: parseString(body.source) || "discord",
    status: parseString(body.status) || undefined,
    title: parseNullableString(body.title) ?? undefined,
    discordGuildId: parseNullableString(body.discordGuildId ?? body.discord_guild_id) ?? undefined,
    discordChannelId: parseNullableString(body.discordChannelId ?? body.discord_channel_id) ?? undefined,
    discordThreadId: parseNullableString(body.discordThreadId ?? body.discord_thread_id) ?? undefined,
    linkedChangeRequestId: parseNullableString(body.linkedChangeRequestId ?? body.linked_change_request_id) ?? undefined,
    linkedTargetEnvironmentId: parseNullableString(body.linkedTargetEnvironmentId ?? body.linked_target_environment_id) ?? undefined,
    meta: body.meta && typeof body.meta === "object" && !Array.isArray(body.meta) ? body.meta as Record<string, unknown> : {},
    createdByUserId: parseNullableString(body.createdByUserId ?? body.created_by_user_id) ?? undefined,
    lastMessageAt: parseNullableString(body.lastMessageAt ?? body.last_message_at) ?? undefined,
  })

  return NextResponse.json({ ok: true, session }, { status: 201 })
}
