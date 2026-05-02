"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Eye, GitBranch, RefreshCw, Route } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

type WorkflowRecord = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  version: number;
  definition: Record<string, unknown>;
  systemDefault: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type WorkflowsPayload = {
  ok?: boolean;
  workflows?: WorkflowRecord[];
  error?: string;
};

function workflowSteps(workflow: WorkflowRecord) {
  return Array.isArray(workflow.definition.steps)
    ? workflow.definition.steps.filter(
        (step): step is Record<string, unknown> => Boolean(step) && typeof step === "object" && !Array.isArray(step),
      )
    : [];
}

function stepLabel(step: Record<string, unknown>) {
  return typeof step.label === "string" && step.label.trim()
    ? step.label
    : typeof step.name === "string" && step.name.trim()
    ? step.name
    : typeof step.key === "string"
      ? step.key
      : "Step";
}

function stepType(step: Record<string, unknown>) {
  return typeof step.type === "string" && step.type.trim() ? step.type : "unknown";
}

export function WorkflowsWorkspace() {
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowRecord | null>(null);
  const [isRefreshing, startRefresh] = useTransition();

  async function loadWorkflows() {
    const response = await fetch("/admin/workflows", { cache: "no-store" });
    const payload = (await response.json()) as WorkflowsPayload;
    if (!response.ok || !payload.ok || !Array.isArray(payload.workflows)) {
      throw new Error(payload.error || "Could not load workflows");
    }
    setWorkflows(payload.workflows);
    setError(null);
  }

  function refresh() {
    setError(null);
    startRefresh(async () => {
      try {
        await loadWorkflows();
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Could not load workflows");
      }
    });
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(
    () => ({
      total: workflows.length,
      enabled: workflows.filter((workflow) => workflow.enabled).length,
      system: workflows.filter((workflow) => workflow.systemDefault).length,
    }),
    [workflows],
  );

  return (
    <div className="grid gap-5 px-5 py-5 md:px-6">
      <section className="grid gap-3 md:grid-cols-3">
        <div className="border border-border/70 bg-background p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Workflows</p>
          <p className="mt-2 text-3xl font-semibold">{counts.total}</p>
        </div>
        <div className="border border-border/70 bg-background p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Enabled</p>
          <p className="mt-2 text-3xl font-semibold">{counts.enabled}</p>
        </div>
        <div className="border border-border/70 bg-background p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">System</p>
          <p className="mt-2 text-3xl font-semibold">{counts.system}</p>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Workflow Definitions</p>
          <p className="text-sm text-muted-foreground">
            Read-only registry for request orchestration definitions. Chat authoring can target this shape later.
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

      <section className="grid gap-3">
        {workflows.map((workflow) => {
          const steps = workflowSteps(workflow);
          return (
            <div
              key={workflow.key}
              className="grid gap-4 border border-border/70 bg-background p-4 xl:grid-cols-[minmax(220px,1fr)_minmax(360px,1.4fr)_auto]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Route className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-base font-semibold">{workflow.name}</h2>
                  <Badge variant={workflow.enabled ? "default" : "outline"}>
                    {workflow.enabled ? "enabled" : "disabled"}
                  </Badge>
                  {workflow.systemDefault ? <Badge variant="outline">system</Badge> : null}
                  <Badge variant="outline">v{workflow.version}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {workflow.description || "No description found."}
                </p>
                <p className="mt-2 truncate text-xs text-muted-foreground">{workflow.key}</p>
              </div>

              <div className="grid gap-2">
                {steps.slice(0, 5).map((step, index) => (
                  <div
                    key={`${workflow.key}:${String(step.key ?? index)}`}
                    className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 text-sm"
                  >
                    <div className="flex h-7 w-7 items-center justify-center border border-border/70 bg-muted/30 text-xs">
                      {index + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{stepLabel(step)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {typeof step.key === "string" ? step.key : "unkeyed"}
                      </p>
                    </div>
                    <Badge variant="outline">{stepType(step)}</Badge>
                  </div>
                ))}
                {steps.length > 5 ? (
                  <p className="text-xs text-muted-foreground">+{steps.length - 5} more steps</p>
                ) : null}
                {!steps.length ? (
                  <p className="text-sm text-muted-foreground">No steps in definition.</p>
                ) : null}
              </div>

              <div className="flex items-center justify-end">
                <Button type="button" variant="outline" onClick={() => setSelectedWorkflow(workflow)}>
                  <Eye className="h-4 w-4" />
                  View JSON
                </Button>
              </div>
            </div>
          );
        })}
        {!workflows.length && !error ? (
          <div className="border border-border/70 bg-background px-4 py-8 text-sm text-muted-foreground">
            No workflows registered.
          </div>
        ) : null}
      </section>

      <Dialog open={Boolean(selectedWorkflow)} onOpenChange={(open) => !open && setSelectedWorkflow(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              {selectedWorkflow?.name ?? "Workflow"}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] border border-border/70 bg-muted/20">
            <pre className="whitespace-pre-wrap break-words p-4 text-xs leading-6">
              {selectedWorkflow ? JSON.stringify(selectedWorkflow.definition, null, 2) : ""}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
