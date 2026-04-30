"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Play,
  RefreshCw,
  Save,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { TaskRecord, TaskRunRecord } from "@/lib/app-core";

type RunnerTask = {
  key: string;
  enabled: boolean;
  cron: string;
  status: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextRunAt: string | null;
};

type RunnerStatus = {
  configured: boolean;
  reachable: boolean;
  tasks: RunnerTask[];
  error: string | null;
};

type TaskPayload = {
  ok: boolean;
  tasks: TaskRecord[];
  runs: TaskRunRecord[];
  runner: RunnerStatus;
  error?: string;
};

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: string) {
  if (status === "succeeded") {
    return (
      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800">
        succeeded
      </Badge>
    );
  }
  if (status === "running") {
    return <Badge variant="secondary">running</Badge>;
  }
  if (status === "failed") {
    return <Badge variant="destructive">failed</Badge>;
  }
  if (status === "disabled") {
    return <Badge variant="muted">disabled</Badge>;
  }
  return <Badge variant="outline">{status || "unknown"}</Badge>;
}

function taskDescription(key: string) {
  if (key === "discord-sync") return "Pulls Discord activity into Prism.";
  if (key === "memory-run") return "Runs the Prism Memory pipeline.";
  if (key === "knowledge-run") return "Refreshes Prism Knowledge artifacts.";
  if (key === "knowledge-source-sync") return "Checks configured GitHub knowledge sources and syncs changed branches.";
  return "Scheduled task";
}

export function TaskRunnerWorkspace() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [runs, setRuns] = useState<TaskRunRecord[]>([]);
  const [runner, setRunner] = useState<RunnerStatus>({
    configured: false,
    reachable: false,
    tasks: [],
    error: null,
  });
  const [drafts, setDrafts] = useState<Record<string, { enabled: boolean; scheduleCron: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [isRefreshing, startRefresh] = useTransition();

  async function loadTasks() {
    const response = await fetch("/admin/tasks", { cache: "no-store" });
    const payload = (await response.json()) as TaskPayload;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Could not load tasks");
    }

    setTasks(payload.tasks);
    setRuns(payload.runs);
    setRunner(payload.runner);
    setDrafts((current) => {
      const next = { ...current };
      for (const task of payload.tasks) {
        if (!next[task.key]) {
          next[task.key] = {
            enabled: task.enabled,
            scheduleCron: task.scheduleCron ?? "",
          };
        }
      }
      return next;
    });
  }

  function refresh() {
    setError(null);
    startRefresh(async () => {
      try {
        await loadTasks();
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Could not load tasks");
      }
    });
  }

  useEffect(() => {
    refresh();
    const intervalId = window.setInterval(refresh, 5000);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const latestRunByTask = useMemo(() => {
    const map = new Map<string, TaskRunRecord>();
    for (const run of runs) {
      if (run.taskKey && !map.has(run.taskKey)) {
        map.set(run.taskKey, run);
      }
    }
    return map;
  }, [runs]);

  const runnerByTask = useMemo(() => {
    const map = new Map<string, RunnerTask>();
    for (const task of runner.tasks) {
      map.set(task.key, task);
    }
    return map;
  }, [runner.tasks]);

  async function saveTask(task: TaskRecord) {
    const draft = drafts[task.key];
    if (!draft) return;

    setError(null);
    setSavingKey(task.key);
    try {
      const response = await fetch("/admin/tasks", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: task.key,
          enabled: draft.enabled,
          scheduleCron: draft.scheduleCron.trim() || null,
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Could not save task");
      }
      await loadTasks();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not save task");
    } finally {
      setSavingKey(null);
    }
  }

  async function runTask(task: TaskRecord) {
    setError(null);
    setRunningKey(task.key);
    try {
      const response = await fetch(`/admin/tasks/${encodeURIComponent(task.key)}/run`, {
        method: "POST",
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Could not run task");
      }
      await loadTasks();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not run task");
    } finally {
      setRunningKey(null);
    }
  }

  return (
    <div className="grid gap-5 px-5 py-5 md:px-6">
      <section className="grid gap-3 md:grid-cols-3">
        <div className="border border-border/70 bg-background p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            DB Tasks
          </p>
          <p className="mt-2 text-3xl font-semibold">{tasks.length}</p>
        </div>
        <div className="border border-border/70 bg-background p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Enabled
          </p>
          <p className="mt-2 text-3xl font-semibold">
            {tasks.filter((task) => task.enabled).length}
          </p>
        </div>
        <div className="border border-border/70 bg-background p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Runner
          </p>
          <div className="mt-3 flex items-center gap-2">
            {runner.reachable ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            )}
            <p className="text-sm font-medium">
              {runner.reachable
                ? "Reachable"
                : runner.configured
                  ? "Unreachable"
                  : "Not configured"}
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Scheduled Tasks</p>
          <p className="text-sm text-muted-foreground">
            DB rows are the source of truth. The task-runner refreshes them on each poll.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={refresh} disabled={isRefreshing}>
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {runner.error ? (
        <div className="border border-border/70 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {runner.error}
        </div>
      ) : null}

      <section className="grid gap-3">
        {tasks.map((task) => {
          const draft = drafts[task.key] ?? {
            enabled: task.enabled,
            scheduleCron: task.scheduleCron ?? "",
          };
          const latestRun = latestRunByTask.get(task.key);
          const runnerTask = runnerByTask.get(task.key);
          const dirty =
            draft.enabled !== task.enabled ||
            draft.scheduleCron.trim() !== (task.scheduleCron ?? "");

          return (
            <div
              key={task.id}
              className="grid gap-4 border border-border/70 bg-background p-4 lg:grid-cols-[minmax(220px,1fr)_minmax(280px,360px)_minmax(220px,280px)]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold">{task.name}</h2>
                  <Badge variant="outline">{task.key}</Badge>
                  {statusBadge(runnerTask?.status ?? latestRun?.status ?? (task.enabled ? "idle" : "disabled"))}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {task.description || taskDescription(task.key)}
                </p>
                <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
                  <span>Last run: {formatDate(runnerTask?.lastRunAt ?? latestRun?.startedAt ?? null)}</span>
                  <span>Last success: {formatDate(runnerTask?.lastSuccessAt ?? null)}</span>
                  <span>Next run: {formatDate(runnerTask?.nextRunAt ?? null)}</span>
                </div>
              </div>

              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor={`${task.key}-enabled`}>Enabled</Label>
                  <Switch
                    id={`${task.key}-enabled`}
                    checked={draft.enabled}
                    onCheckedChange={(checked) =>
                      setDrafts((current) => ({
                        ...current,
                        [task.key]: { ...draft, enabled: checked },
                      }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`${task.key}-cron`} className="flex items-center gap-2">
                    <Clock3 className="h-4 w-4" />
                    Cron
                  </Label>
                  <Input
                    id={`${task.key}-cron`}
                    value={draft.scheduleCron}
                    placeholder="0 * * * *"
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [task.key]: { ...draft, scheduleCron: event.target.value },
                      }))
                    }
                  />
                </div>
              </div>

              <div className="flex flex-col justify-between gap-3">
                <div className="grid gap-1 text-xs text-muted-foreground">
                  <span>Updated: {formatDate(task.updatedAt)}</span>
                  <span>Timezone: {task.timezone}</span>
                  {runnerTask?.lastError ? (
                    <span className="text-destructive">{runnerTask.lastError}</span>
                  ) : null}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => runTask(task)}
                    disabled={!runner.configured || runningKey === task.key}
                    title={
                      runner.configured
                        ? "Run task now"
                        : "Set TASK_RUNNER_BASE_URL on the site service"
                    }
                  >
                    <Play className="h-4 w-4" />
                    Run
                  </Button>
                  <Button
                    type="button"
                    onClick={() => saveTask(task)}
                    disabled={!dirty || savingKey === task.key}
                  >
                    <Save className="h-4 w-4" />
                    Save
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <section className="grid gap-3">
        <div>
          <p className="text-sm font-medium">Recent Runs</p>
          <p className="text-sm text-muted-foreground">
            Latest task-run rows written by scheduled or manual execution.
          </p>
        </div>
        <div className="overflow-x-auto border border-border/70 bg-background">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-border/70 bg-muted/40 text-xs uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Task</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Started</th>
                <th className="px-4 py-3 font-medium">Finished</th>
                <th className="px-4 py-3 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 20).map((run) => (
                <tr key={run.id} className="border-b border-border/50 last:border-b-0">
                  <td className="px-4 py-3 font-medium">{run.taskKey ?? "unknown"}</td>
                  <td className="px-4 py-3">{statusBadge(run.status)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{run.triggerSource}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(run.startedAt)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(run.finishedAt)}</td>
                  <td className="max-w-[280px] truncate px-4 py-3 text-muted-foreground">
                    {run.errorMessage || run.resultSummary || ""}
                  </td>
                </tr>
              ))}
              {!runs.length ? (
                <tr>
                  <td className="px-4 py-6 text-center text-muted-foreground" colSpan={6}>
                    No task runs recorded yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
