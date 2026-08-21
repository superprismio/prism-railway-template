import { NextResponse } from "next/server"

import { requireCapabilityAccess } from "@/lib/admin-auth"
import { fetchPrismMemoryJson } from "@/lib/prism-memory"
import { listRollingDatesFromArtifacts, parseRollingDay } from "@/lib/prism-lab/memory"

export async function GET() {
  const access = await requireCapabilityAccess("canViewMemory")
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status })

  const params = new URLSearchParams({ category: "memory", limit: "200" })
  const [artifacts, latest] = await Promise.all([
    fetchPrismMemoryJson("/api/artifacts", params, ["category", "limit"]),
    fetchPrismMemoryJson("/memory/latest"),
  ])
  const latestDay = latest.ok ? parseRollingDay(latest.data) : null
  const dates = artifacts.ok ? listRollingDatesFromArtifacts(artifacts.data) : []
  if (latestDay && !dates.includes(latestDay.date)) dates.unshift(latestDay.date)
  const uniqueDates = Array.from(new Set(dates)).sort((left, right) => right.localeCompare(left))

  if (!latestDay && !artifacts.ok) {
    return NextResponse.json({ ok: false, error: latest.error || artifacts.error }, { status: latest.status || artifacts.status })
  }
  return NextResponse.json({
    ok: true,
    latestDate: latestDay?.date ?? uniqueDates[0] ?? null,
    dates: uniqueDates,
    warnings: [!artifacts.ok ? `Rolling date index unavailable: ${artifacts.error}` : null, !latest.ok ? `Latest snapshot unavailable: ${latest.error}` : null].filter(Boolean),
  })
}
