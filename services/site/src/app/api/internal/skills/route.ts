import { NextResponse } from "next/server"
import { listHostedSkills, loadConfig } from "@prism-railway/app-core"

import { requireServiceAccess } from "@/lib/internal-service"

export async function GET() {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const config = loadConfig()
  const skills = listHostedSkills(config.repoRoot).map((skill) => ({
    ...skill,
    downloadPath: `/api/internal/skills/${skill.name}/download`,
  }))

  return NextResponse.json({ ok: true, skills })
}
