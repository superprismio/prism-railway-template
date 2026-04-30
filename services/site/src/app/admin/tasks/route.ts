import { NextResponse } from "next/server";

import { listTaskRuns, listTasks, upsertTask } from "@/lib/app-core";
import { parseNullableString, parseString, requireLocalAdminAccess } from "@/lib/local-admin-api";

function parseBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function taskRunnerBaseUrl() {
  return (process.env.TASK_RUNNER_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

function taskRunnerToken() {
  return (process.env.TASK_RUNNER_TOKEN ?? process.env.INTERNAL_SERVICE_TOKEN ?? "").trim();
}

async function fetchRunnerTasks() {
  const baseUrl = taskRunnerBaseUrl();
  if (!baseUrl) {
    return { configured: false, reachable: false, tasks: [], error: null };
  }

  try {
    const response = await fetch(`${baseUrl}/tasks`, {
      cache: "no-store",
      headers: taskRunnerToken() ? { "x-task-runner-token": taskRunnerToken() } : {},
    });
    const payload = (await response.json().catch(() => ({}))) as {
      tasks?: unknown[];
      error?: string;
    };

    return {
      configured: true,
      reachable: response.ok,
      tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
      error: response.ok ? null : payload.error ?? `Task runner returned ${response.status}`,
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      tasks: [],
      error: error instanceof Error ? error.message : "Task runner request failed",
    };
  }
}

export async function GET() {
  const access = await requireLocalAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const [runner, tasks, runs] = await Promise.all([
    fetchRunnerTasks(),
    Promise.resolve(listTasks()),
    Promise.resolve(listTaskRuns({ limit: 75 })),
  ]);

  return NextResponse.json({ ok: true, tasks, runs, runner });
}

export async function PATCH(request: Request) {
  const access = await requireLocalAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const key = parseString(body?.key);
  if (!key) {
    return NextResponse.json({ ok: false, error: "Task key is required" }, { status: 400 });
  }

  const current = listTasks().find((task) => task.key === key);
  if (!current) {
    return NextResponse.json({ ok: false, error: "Task not found" }, { status: 404 });
  }

  const enabled = parseBoolean(body?.enabled);
  const scheduleCron = parseNullableString(body?.scheduleCron ?? body?.schedule_cron);

  const task = upsertTask({
    key: current.key,
    name: current.name,
    description: current.description,
    enabled: enabled ?? current.enabled,
    triggerType: current.triggerType,
    scheduleCron: scheduleCron === undefined ? current.scheduleCron : scheduleCron,
    timezone: current.timezone,
    taskType: current.taskType,
    inputConfig: current.inputConfig,
    instructionConfig: current.instructionConfig,
    outputConfig: current.outputConfig,
  });

  return NextResponse.json({ ok: true, task });
}
