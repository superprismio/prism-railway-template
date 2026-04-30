import { NextResponse } from "next/server"
import { listTasks, upsertTask } from "@/lib/app-core"
import { parseNullableString, parseString, requireServiceAccess } from "@/lib/internal-service"

function parseBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value
  if (typeof value === "string") return new Set(["1", "true", "yes", "on"]).has(value.trim().toLowerCase())
  return fallback
}

function parseConfig(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export async function GET() {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  return NextResponse.json({ ok: true, tasks: listTasks() })
}

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
  const key = parseString(body.key)
  const name = parseString(body.name)
  if (!key || !name) {
    return NextResponse.json({ ok: false, error: "key and name are required" }, { status: 400 })
  }

  const task = upsertTask({
    key,
    name,
    description: parseNullableString(body.description) ?? null,
    enabled: parseBoolean(body.enabled),
    triggerType: parseString(body.triggerType ?? body.trigger_type) || "schedule",
    scheduleCron: parseNullableString(body.scheduleCron ?? body.schedule_cron) ?? null,
    timezone: parseString(body.timezone) || "UTC",
    taskType: parseString(body.taskType ?? body.task_type) || "builtin",
    inputConfig: parseConfig(body.inputConfig ?? body.input_config),
    instructionConfig: parseConfig(body.instructionConfig ?? body.instruction_config),
    outputConfig: parseConfig(body.outputConfig ?? body.output_config),
  })

  return NextResponse.json({ ok: true, task })
}
