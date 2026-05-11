import { NextResponse } from "next/server"

import { deleteCustomSkill, listHostedSkills, loadConfig, readHostedSkillMarkdown } from "@/lib/app-core"
import { parseNullableString, readRouteParam, requireLocalAdminAccess } from "@/lib/local-admin-api"

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

export async function DELETE(_request: Request, context: RouteContext) {
  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { name } = await context.params
  const config = loadConfig()
  const skillName = readRouteParam(name)
  const existing = listHostedSkills(config.repoRoot, config.customSkillsRoot).find((skill) => skill.name === skillName)
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Skill not found" }, { status: 404 })
  }
  if (existing.kind !== "custom") {
    return NextResponse.json({ ok: false, error: "Built-in skills cannot be deleted" }, { status: 409 })
  }

  const skill = deleteCustomSkill(config.customSkillsRoot, skillName)
  if (!skill) {
    return NextResponse.json({ ok: false, error: "Skill not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, skill })
}
