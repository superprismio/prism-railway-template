import { NextResponse } from "next/server"
import { deleteCustomTaskByKey, getTaskByKey, getTaskScriptByKey, listTasks, upsertTask } from "@/lib/app-core"
import { parseNullableString, parseString, requireServiceAccess } from "@/lib/internal-service"

function parseBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value
  if (typeof value === "string") return new Set(["1", "true", "yes", "on"]).has(value.trim().toLowerCase())
  return fallback
}

function parseBooleanFlag(value: unknown) {
  return parseBoolean(value, false)
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

  if (parseBooleanFlag(body.preserveExisting ?? body.preserve_existing)) {
    const existing = getTaskByKey(key)
    if (existing) {
      return NextResponse.json({ ok: true, task: existing, preserved: true })
    }
  }

  const enabled = parseBoolean(body.enabled)
  const taskType = parseString(body.taskType ?? body.task_type) || "builtin"
  const inputConfig = parseConfig(body.inputConfig ?? body.input_config)
  let normalizedInputConfig = inputConfig
  if (taskType === "script-runner") {
    const scriptKey = parseString(inputConfig.scriptKey ?? inputConfig.script_key)
    if (!scriptKey) {
      return NextResponse.json({ ok: false, error: "script-runner tasks require inputConfig.scriptKey" }, { status: 400 })
    }
    const script = getTaskScriptByKey(scriptKey)
    if (!script) {
      return NextResponse.json({ ok: false, error: `Task script not found: ${scriptKey}` }, { status: 400 })
    }
    if (enabled && !script.enabled) {
      return NextResponse.json({ ok: false, error: `Task script is disabled: ${scriptKey}` }, { status: 400 })
    }
    normalizedInputConfig = { ...inputConfig, scriptKey }
  }

  const task = upsertTask({
    key,
    name,
    description: parseNullableString(body.description) ?? null,
    enabled,
    triggerType: parseString(body.triggerType ?? body.trigger_type) || "schedule",
    scheduleCron: parseNullableString(body.scheduleCron ?? body.schedule_cron) ?? null,
    timezone: parseString(body.timezone) || "UTC",
    taskType,
    inputConfig: normalizedInputConfig,
    instructionConfig: parseConfig(body.instructionConfig ?? body.instruction_config),
    outputConfig: parseConfig(body.outputConfig ?? body.output_config),
    agentConfig: parseConfig(body.agentConfig ?? body.agent_config),
  })

  return NextResponse.json({ ok: true, task })
}

export async function DELETE(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const url = new URL(request.url)
  const disabledOnly = parseBoolean(url.searchParams.get("disabledOnly") ?? url.searchParams.get("disabled_only"))
  if (!disabledOnly) {
    return NextResponse.json(
      { ok: false, error: "disabledOnly=true is required for bulk task deletion" },
      { status: 400 },
    )
  }

  const deleted = []
  const skipped = []
  for (const task of listTasks()) {
    if (task.enabled) continue
    if (task.taskType === "builtin") {
      skipped.push({ key: task.key, reason: "system-default" })
      continue
    }
    const removed = deleteCustomTaskByKey(task.key)
    if (removed) {
      deleted.push(removed)
    }
  }

  return NextResponse.json({ ok: true, deleted, skipped })
}
