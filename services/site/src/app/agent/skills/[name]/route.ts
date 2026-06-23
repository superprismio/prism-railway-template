import { NextResponse } from "next/server"

import { deleteCustomSkill, listHostedSkillSourceRoots, listHostedSkills, loadConfig } from "@/lib/app-core"
import { requireServiceAccess } from "@/lib/internal-service"
import { readRouteParam } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ name: string }>
}

export async function DELETE(_request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { name } = await context.params
  const config = loadConfig()
  const skillName = readRouteParam(name)
  const existing = listHostedSkills(config.repoRoot, config.customSkillsRoot, listHostedSkillSourceRoots()).find((skill) => skill.name === skillName)
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Skill not found" }, { status: 404 })
  }
  if (existing.kind !== "custom") {
    return NextResponse.json({ ok: false, error: "Only instance custom skills can be deleted" }, { status: 409 })
  }

  const skill = deleteCustomSkill(config.customSkillsRoot, skillName)
  if (!skill) {
    return NextResponse.json({ ok: false, error: "Skill not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, skill })
}
