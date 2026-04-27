import { NextResponse } from "next/server"
import { findAgentSessionByDiscordContext, listAgentMessages } from "@prism-railway/app-core"

import { parseNullableString, readOptionalInteger, requireServiceAccess } from "@/lib/internal-service"

export async function GET(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const url = new URL(request.url)
  const session = findAgentSessionByDiscordContext({
    discordThreadId: parseNullableString(url.searchParams.get("threadId") ?? url.searchParams.get("thread_id")) ?? undefined,
    discordChannelId: parseNullableString(url.searchParams.get("channelId") ?? url.searchParams.get("channel_id")) ?? undefined,
  })

  if (!session) {
    return NextResponse.json({ ok: false, error: "Agent session not found" }, { status: 404 })
  }

  const limit = readOptionalInteger(url.searchParams.get("limit")) ?? 100
  return NextResponse.json({ ok: true, session, messages: listAgentMessages(session.id, limit) })
}
