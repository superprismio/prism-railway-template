"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Eye,
  Plus,
  Play,
  RefreshCw,
  Save,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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

function taskTypeBadge(taskType: string) {
  if (taskType === "builtin") {
    return <Badge variant="secondary">System</Badge>;
  }
  if (taskType === "codex-prompt") {
    return <Badge variant="outline">Custom</Badge>;
  }
  return <Badge variant="muted">{taskType || "task"}</Badge>;
}

function formatSnapshot(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJsonObject(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function runResponseText(run: TaskRunRecord | null) {
  const body = run?.outputSnapshot?.body;
  const parsedBody = parseJsonObject(body);
  const directText =
    parsedBody?.responseText ??
    parsedBody?.output_text ??
    parsedBody?.text ??
    run?.outputSnapshot?.responseText ??
    run?.outputSnapshot?.output_text;

  return typeof directText === "string" && directText.trim()
    ? directText.trim()
    : null;
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
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedRun, setSelectedRun] = useState<TaskRunRecord | null>(null);
  const [createForm, setCreateForm] = useState({
    name: "",
    scheduleCron: "0 9 * * *",
    prompt: "",
  });
  const hasLoadedTasksRef = useRef(false);
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
    hasLoadedTasksRef.current = true;
    setError(null);
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
        if (!hasLoadedTasksRef.current) {
          setError(nextError instanceof Error ? nextError.message : "Could not load tasks");
        }
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
  const selectedRunResponse = runResponseText(selectedRun);

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

  async function createCustomTask() {
    setError(null);
    setIsCreating(true);
    try {
      const response = await fetch("/admin/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createForm),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Could not create task");
      }
      setCreateForm({ name: "", scheduleCron: "0 9 * * *", prompt: "" });
      setIsCreateOpen(false);
      await loadTasks();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not create task");
    } finally {
      setIsCreating(false);
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
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New Custom Task
          </Button>
          <Button type="button" variant="outline" onClick={refresh} disabled={isRefreshing}>
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
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
                  {taskTypeBadge(task.taskType)}
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
                <th className="px-4 py-3 font-medium text-right">Actions</th>
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
                  <td className="px-4 py-3 text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedRun(run)}
                    >
                      <Eye className="h-4 w-4" />
                      View
                    </Button>
                  </td>
                </tr>
              ))}
              {!runs.length ? (
                <tr>
                  <td className="px-4 py-6 text-center text-muted-foreground" colSpan={7}>
                    No task runs recorded yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New Custom Task</DialogTitle>
            <DialogDescription>
              Create a disabled scheduled prompt task. Use chat for tasks that need to
              resolve output destinations like Discord channels, then enable after a
              manual run succeeds.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="custom-task-name">Name</Label>
              <Input
                id="custom-task-name"
                value={createForm.name}
                onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Daily memory brief"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="custom-task-cron">Cron</Label>
              <Input
                id="custom-task-cron"
                value={createForm.scheduleCron}
                onChange={(event) => setCreateForm((current) => ({ ...current, scheduleCron: event.target.value }))}
                placeholder="0 9 * * *"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="custom-task-prompt">Prompt</Label>
              <Textarea
                id="custom-task-prompt"
                value={createForm.prompt}
                onChange={(event) => setCreateForm((current) => ({ ...current, prompt: event.target.value }))}
                rows={8}
                placeholder="Create a concise daily brief from Prism Memory. Do not ask follow-up questions. Return the brief and a short summary of what sources you used."
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={createCustomTask}
              disabled={isCreating || !createForm.name.trim() || !createForm.scheduleCron.trim() || !createForm.prompt.trim()}
            >
              <Plus className="h-4 w-4" />
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedRun)}
        onOpenChange={(open) => {
          if (!open) setSelectedRun(null);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Task Run</DialogTitle>
            <DialogDescription>
              {selectedRun?.taskKey ?? "unknown"} - {selectedRun?.triggerSource ?? "unknown"} -{" "}
              {selectedRun ? formatDate(selectedRun.startedAt) : "Not recorded"}
            </DialogDescription>
          </DialogHeader>
          {selectedRun ? (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                {statusBadge(selectedRun.status)}
                <Badge variant="outline">{selectedRun.taskName ?? selectedRun.taskKey ?? "unknown"}</Badge>
              </div>

              {selectedRun.resultSummary ? (
                <div className="grid gap-2">
                  <p className="text-sm font-medium">Summary</p>
                  <p className="whitespace-pre-wrap border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
                    {selectedRun.resultSummary}
                  </p>
                </div>
              ) : null}

              {selectedRun.errorMessage ? (
                <div className="grid gap-2">
                  <p className="text-sm font-medium text-destructive">Error</p>
                  <p className="whitespace-pre-wrap border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    {selectedRun.errorMessage}
                  </p>
                </div>
              ) : null}

              {selectedRunResponse ? (
                <div className="grid gap-2">
                  <p className="text-sm font-medium">Response</p>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
                    {selectedRunResponse}
                  </pre>
                </div>
              ) : null}

              <div className="grid gap-2">
                <p className="text-sm font-medium">Output Snapshot</p>
                <pre className="max-h-80 overflow-auto border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
                  {formatSnapshot(selectedRun.outputSnapshot)}
                </pre>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
