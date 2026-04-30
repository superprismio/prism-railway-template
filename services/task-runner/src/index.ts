import express, { type Request, type Response } from "express";
import { CronExpressionParser } from "cron-parser";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

type TaskKey = "discord-sync" | "memory-run" | "knowledge-run";

type TaskStatus = "idle" | "running" | "succeeded" | "failed" | "disabled";

type BuiltInTask = {
  key: TaskKey;
  name: string;
  defaultEnabled: boolean;
  defaultCron: string;
  enabled: boolean;
  cron: string;
  run: () => Promise<TaskRunResult>;
};

type TaskSnapshot = {
  key: TaskKey;
  name: string;
  enabled: boolean;
  cron: string;
  status: TaskStatus;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextRunAt: string | null;
};

type TaskRunResult = {
  ok: boolean;
  status: number;
  url: string;
  body: string;
};

type AppTaskRun = {
  id: string;
};

type AppTask = {
  key: string;
  enabled: boolean;
  scheduleCron: string | null;
};

type TaskState = {
  status: TaskStatus;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextRunAt: Date | null;
  running: boolean;
};

const state = new Map<TaskKey, TaskState>();

function nowIso(): string {
  return new Date().toISOString();
}

function parseBoolEnv(name: string, defaultValue: boolean): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) {
    return defaultValue;
  }
  return new Set(["1", "true", "yes", "on"]).has(raw);
}

function parseIntEnv(name: string, defaultValue: number, minimum?: number, maximum?: number): number {
  const raw = (process.env[name] ?? "").trim();
  let value = raw ? Number.parseInt(raw, 10) : defaultValue;
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be an integer`);
  }
  if (typeof minimum === "number") {
    value = Math.max(minimum, value);
  }
  if (typeof maximum === "number") {
    value = Math.min(maximum, value);
  }
  return value;
}

function trimBaseUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message.trim()) {
      return `${error.message.trim()}: ${cause.message.trim()}`;
    }
    if (cause) {
      return `${error.message.trim()}: ${String(cause)}`;
    }
    return error.message.trim();
  }
  return String(error);
}

function nextCronDate(cron: string, from = new Date()): Date {
  const expression = CronExpressionParser.parse(cron, {
    currentDate: from,
  });
  return expression.next().toDate();
}

function initState(task: BuiltInTask): TaskState {
  if (!task.enabled) {
    return {
      status: "disabled",
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      nextRunAt: null,
      running: false,
    };
  }
  return {
    status: "idle",
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    nextRunAt: nextCronDate(task.cron),
    running: false,
  };
}

function requireBaseUrl(name: string, value: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function appApiBaseUrl(): string | null {
  const baseUrl = trimBaseUrl(process.env.APP_API_BASE_URL);
  return baseUrl || null;
}

function appApiServiceToken(): string {
  return (process.env.APP_API_SERVICE_TOKEN ?? process.env.INTERNAL_SERVICE_TOKEN ?? "").trim();
}

async function postJson(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  body: Record<string, unknown> = {},
): Promise<TaskRunResult> {
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 500)}`);
  }
  return {
    ok: true,
    status: response.status,
    url,
    body: text,
  };
}

async function appApiRequest(path: string, init: RequestInit): Promise<Record<string, unknown> | null> {
  const baseUrl = appApiBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const token = appApiServiceToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("X-Service-Token", token);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`APP_API_REQUEST_FAILED:${response.status}:${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

function isAppTask(value: unknown): value is AppTask {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { key?: unknown; enabled?: unknown; scheduleCron?: unknown };
  return (
    typeof candidate.key === "string"
    && typeof candidate.enabled === "boolean"
    && (candidate.scheduleCron === null || typeof candidate.scheduleCron === "string")
  );
}

async function registerTaskWithSite(task: BuiltInTask): Promise<void> {
  try {
    await appApiRequest("/api/internal/tasks", {
      method: "POST",
      body: JSON.stringify({
        key: task.key,
        name: task.name,
        description: `Built-in scheduled task: ${task.name}`,
        enabled: task.defaultEnabled,
        triggerType: "schedule",
        scheduleCron: task.defaultCron,
        timezone: "UTC",
        taskType: "builtin",
        inputConfig: {},
        instructionConfig: {},
        outputConfig: {},
        preserveExisting: true,
      }),
    });
  } catch (error) {
    console.warn(JSON.stringify({ event: "task.site_register_failed", task: task.key, error: describeError(error) }));
  }
}

async function fetchTasksFromSite(): Promise<AppTask[] | null> {
  try {
    const payload = await appApiRequest("/api/internal/tasks", { method: "GET" });
    const rows = payload?.tasks;
    if (!Array.isArray(rows)) {
      return null;
    }
    return rows.filter(isAppTask);
  } catch (error) {
    console.warn(JSON.stringify({ event: "task.site_fetch_failed", error: describeError(error) }));
    return null;
  }
}

function applyTaskConfig(task: BuiltInTask, config: { enabled: boolean; cron: string }): void {
  const taskState = state.get(task.key);
  const previousEnabled = task.enabled;
  const previousCron = task.cron;

  task.enabled = config.enabled;
  task.cron = config.cron;

  if (!taskState) {
    state.set(task.key, initState(task));
    return;
  }

  if (!task.enabled) {
    taskState.status = taskState.running ? "running" : "disabled";
    taskState.nextRunAt = null;
    return;
  }

  if (!previousEnabled || previousCron !== task.cron || !taskState.nextRunAt) {
    taskState.nextRunAt = nextCronDate(task.cron);
  }
  if (!taskState.running && taskState.status === "disabled") {
    taskState.status = "idle";
  }
}

async function syncTasksFromSite(tasks: BuiltInTask[]): Promise<void> {
  const siteTasks = await fetchTasksFromSite();
  if (!siteTasks) {
    return;
  }
  for (const task of tasks) {
    const siteTask = siteTasks.find((candidate) => candidate.key === task.key);
    try {
      applyTaskConfig(task, {
        enabled: siteTask?.enabled ?? task.defaultEnabled,
        cron: (siteTask?.scheduleCron ?? task.defaultCron).trim() || task.defaultCron,
      });
    } catch (error) {
      console.warn(JSON.stringify({ event: "task.site_config_invalid", task: task.key, error: describeError(error) }));
    }
  }
}

async function createTaskRunInSite(task: BuiltInTask, source: "schedule" | "manual"): Promise<AppTaskRun | null> {
  try {
    const payload = await appApiRequest("/api/internal/tasks/runs", {
      method: "POST",
      body: JSON.stringify({
        taskKey: task.key,
        status: "running",
        triggerSource: source,
        startedAt: nowIso(),
      }),
    });
    const run = payload?.run;
    if (run && typeof run === "object" && "id" in run && typeof (run as { id?: unknown }).id === "string") {
      return { id: (run as { id: string }).id };
    }
  } catch (error) {
    console.warn(JSON.stringify({ event: "task.site_run_create_failed", task: task.key, error: describeError(error) }));
  }
  return null;
}

async function updateTaskRunInSite(
  run: AppTaskRun | null,
  status: "succeeded" | "failed",
  payload: {
    resultSummary?: string | null;
    errorMessage?: string | null;
    outputSnapshot?: Record<string, unknown>;
  },
): Promise<void> {
  if (!run) {
    return;
  }
  try {
    await appApiRequest(`/api/internal/tasks/runs/${encodeURIComponent(run.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        finishedAt: nowIso(),
        resultSummary: payload.resultSummary ?? null,
        errorMessage: payload.errorMessage ?? null,
        outputSnapshot: payload.outputSnapshot ?? {},
      }),
    });
  } catch (error) {
    console.warn(JSON.stringify({ event: "task.site_run_update_failed", runId: run.id, error: describeError(error) }));
  }
}

function buildTasks(): BuiltInTask[] {
  const prismMemoryBaseUrl = trimBaseUrl(process.env.PRISM_MEMORY_BASE_URL ?? process.env.PRISM_API_BASE);
  const prismApiKey = (process.env.PRISM_API_KEY ?? "").trim();
  const discordAdapterBaseUrl = trimBaseUrl(process.env.DISCORD_ADAPTER_BASE_URL);
  const sourceAdapterToken = (process.env.SOURCE_ADAPTER_TOKEN ?? "").trim();

  return [
    {
      key: "discord-sync",
      name: "Discord sync",
      defaultEnabled: false,
      defaultCron: "0 * * * *",
      enabled: false,
      cron: "0 * * * *",
      run: async () => {
        const baseUrl = requireBaseUrl("DISCORD_ADAPTER_BASE_URL", discordAdapterBaseUrl);
        const headers: Record<string, string> = {};
        if (sourceAdapterToken) {
          headers["X-Adapter-Token"] = sourceAdapterToken;
        }
        return postJson(baseUrl, "/sync", headers);
      },
    },
    {
      key: "memory-run",
      name: "Prism memory run",
      defaultEnabled: false,
      defaultCron: "45 * * * *",
      enabled: false,
      cron: "45 * * * *",
      run: async () => {
        const baseUrl = requireBaseUrl("PRISM_MEMORY_BASE_URL", prismMemoryBaseUrl);
        const headers: Record<string, string> = {};
        if (prismApiKey) {
          headers["X-Prism-Api-Key"] = prismApiKey;
        }
        return postJson(baseUrl, "/ops/memory/run", headers);
      },
    },
    {
      key: "knowledge-run",
      name: "Prism knowledge run",
      defaultEnabled: false,
      defaultCron: "55 * * * *",
      enabled: false,
      cron: "55 * * * *",
      run: async () => {
        const baseUrl = requireBaseUrl("PRISM_MEMORY_BASE_URL", prismMemoryBaseUrl);
        const headers: Record<string, string> = {};
        if (prismApiKey) {
          headers["X-Prism-Api-Key"] = prismApiKey;
        }
        return postJson(baseUrl, "/ops/knowledge/run", headers);
      },
    },
  ];
}

async function runTask(task: BuiltInTask, source: "schedule" | "manual"): Promise<TaskRunResult> {
  const taskState = state.get(task.key);
  if (!taskState) {
    throw new Error(`Unknown task state for ${task.key}`);
  }
  if (!task.enabled && source === "schedule") {
    throw new Error(`Task ${task.key} is disabled`);
  }
  if (taskState.running) {
    throw new Error(`Task ${task.key} is already running`);
  }

  taskState.running = true;
  taskState.status = "running";
  taskState.lastRunAt = nowIso();
  taskState.lastError = null;
  const appRun = await createTaskRunInSite(task, source);
  console.log(JSON.stringify({ event: "task.started", task: task.key, source, at: taskState.lastRunAt }));

  try {
    const result = await task.run();
    taskState.status = "succeeded";
    taskState.lastSuccessAt = nowIso();
    taskState.nextRunAt = nextCronDate(task.cron);
    await updateTaskRunInSite(appRun, "succeeded", {
      resultSummary: `HTTP ${result.status} from ${result.url}`,
      outputSnapshot: {
        status: result.status,
        url: result.url,
        body: result.body,
      },
    });
    console.log(
      JSON.stringify({
        event: "task.succeeded",
        task: task.key,
        source,
        status: result.status,
        url: result.url,
        at: taskState.lastSuccessAt,
      }),
    );
    return result;
  } catch (error) {
    const message = describeError(error);
    taskState.status = "failed";
    taskState.lastError = message;
    taskState.nextRunAt = nextCronDate(task.cron);
    await updateTaskRunInSite(appRun, "failed", {
      errorMessage: message,
    });
    console.error(JSON.stringify({ event: "task.failed", task: task.key, source, error: message, at: nowIso() }));
    throw error;
  } finally {
    taskState.running = false;
  }
}

function taskSnapshot(task: BuiltInTask): TaskSnapshot {
  const taskState = state.get(task.key) ?? initState(task);
  return {
    key: task.key,
    name: task.name,
    enabled: task.enabled,
    cron: task.cron,
    status: task.enabled ? taskState.status : "disabled",
    lastRunAt: taskState.lastRunAt,
    lastSuccessAt: taskState.lastSuccessAt,
    lastError: taskState.lastError,
    nextRunAt: task.enabled && taskState.nextRunAt ? taskState.nextRunAt.toISOString() : null,
  };
}

function requireRunnerToken(request: Request, response: Response): boolean {
  const expected = (process.env.TASK_RUNNER_TOKEN ?? "").trim();
  if (!expected) {
    return true;
  }
  const actual = String(request.headers["x-task-runner-token"] ?? "").trim();
  if (actual === expected) {
    return true;
  }
  response.status(401).json({ ok: false, error: "Unauthorized" });
  return false;
}

async function schedulerLoop(tasks: BuiltInTask[], pollSeconds: number): Promise<void> {
  while (true) {
    if (!parseBoolEnv("TASK_RUNNER_DISABLED", false)) {
      await syncTasksFromSite(tasks);
      const now = new Date();
      for (const task of tasks) {
        const taskState = state.get(task.key);
        if (!task.enabled || !taskState || taskState.running || !taskState.nextRunAt) {
          continue;
        }
        if (taskState.nextRunAt.getTime() <= now.getTime()) {
          runTask(task, "schedule").catch(() => {
            // Failure is recorded in task state and logs.
          });
        }
      }
    }
    await sleep(pollSeconds * 1000);
  }
}

async function main(): Promise<void> {
  const tasks = buildTasks();
  for (const task of tasks) {
    state.set(task.key, initState(task));
  }
  await Promise.all(tasks.map((task) => registerTaskWithSite(task)));
  await syncTasksFromSite(tasks);

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      service: "task-runner",
      disabled: parseBoolEnv("TASK_RUNNER_DISABLED", false),
      tasks: tasks.map(taskSnapshot),
    });
  });

  app.get("/tasks", (request, response) => {
    if (!requireRunnerToken(request, response)) {
      return;
    }
    response.json({ ok: true, tasks: tasks.map(taskSnapshot) });
  });

  app.post("/tasks/:key/run", async (request, response) => {
    if (!requireRunnerToken(request, response)) {
      return;
    }
    const key = request.params.key as TaskKey;
    const task = tasks.find((candidate) => candidate.key === key);
    if (!task) {
      response.status(404).json({ ok: false, error: `Unknown task: ${key}` });
      return;
    }
    try {
      const result = await runTask(task, "manual");
      response.json({ ok: true, task: taskSnapshot(task), result });
    } catch (error) {
      response.status(500).json({ ok: false, task: taskSnapshot(task), error: describeError(error) });
    }
  });

  const port = parseIntEnv("PORT", 8790, 1, 65535);
  const pollSeconds = parseIntEnv("TASK_RUNNER_POLL_SECONDS", 60, 5, 3600);
  app.listen(port, () => {
    console.log(JSON.stringify({ event: "task-runner.started", port, pollSeconds, tasks: tasks.map(taskSnapshot) }));
  });

  schedulerLoop(tasks, pollSeconds).catch((error) => {
    console.error(JSON.stringify({ event: "task-runner.scheduler_failed", error: describeError(error) }));
    process.exitCode = 1;
  });
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "task-runner.failed", error: describeError(error) }));
  process.exit(1);
});
