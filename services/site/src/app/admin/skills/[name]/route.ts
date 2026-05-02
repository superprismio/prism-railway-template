import { NextResponse } from "next/server"

import { loadConfig, readHostedSkillMarkdown } from "@/lib/app-core"
import { parseNullableString, requireLocalAdminAccess } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ name: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { name } = await context.params
  const skillName = parseNullableString(name)
  if (!skillName) {
    return NextResponse.json({ ok: false, error: "Skill name is required" }, { status: 400 })
  }

  const config = loadConfig()
  const content = readHostedSkillMarkdown(config.repoRoot, skillName, config.customSkillsRoot)
  if (!content) {
    return NextResponse.json({ ok: false, error: "Skill not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, name: skillName, content })
}
