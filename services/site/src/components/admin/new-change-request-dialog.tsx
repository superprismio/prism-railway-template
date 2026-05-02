"use client";

import { useMemo, useState } from "react";
import { FilePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { TargetAppRecord, WorkflowRecord } from "@/lib/admin";

function workflowRequiresTargetApp(workflow: WorkflowRecord | null | undefined) {
  if (!workflow) return true;
  if (workflow.key === "change-request-default") return true;
  const target = workflow.definition.target;
  return Boolean(
    target &&
    typeof target === "object" &&
    !Array.isArray(target) &&
    "required" in target &&
    target.required === true,
  );
}

export function NewChangeRequestDialog({
  open,
  onOpenChange,
  targetApps,
  workflows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetApps: TargetAppRecord[];
  workflows: WorkflowRecord[];
}) {
  const enabledWorkflows = useMemo(() => workflows.filter((workflow) => workflow.enabled), [workflows]);
  const defaultWorkflowKey = enabledWorkflows.find((workflow) => workflow.key === "change-request-default")?.key
    ?? enabledWorkflows[0]?.key
    ?? "change-request-default";
  const [workflowKey, setWorkflowKey] = useState(defaultWorkflowKey);
  const selectedWorkflow = enabledWorkflows.find((workflow) => workflow.key === workflowKey) ?? null;
  const targetRequired = workflowRequiresTargetApp(selectedWorkflow);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-[28px] border-border/70 bg-background p-0 shadow-[0_28px_90px_-42px_rgba(26,31,44,0.7)]">
        <DialogHeader className="border-b border-border/70 px-6 py-5 text-left">
          <DialogTitle className="text-2xl tracking-tight">
            New Request
          </DialogTitle>
          <DialogDescription>
            Capture the request, workflow, and review context before routing it
            into the workspace.
          </DialogDescription>
        </DialogHeader>

        <form
          action="/admin/requests"
          method="post"
          className="space-y-5 px-6 py-6"
        >
          <div className="space-y-2">
            <Label htmlFor="new-request-title">Title</Label>
            <Input
              id="new-request-title"
              name="title"
              placeholder="Fix mobile treasury panel spacing"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-request-workflow">Workflow</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                id="new-request-workflow"
                name="workflowKey"
                value={workflowKey}
                onChange={(event) => setWorkflowKey(event.target.value)}
              >
                {enabledWorkflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.key}>
                    {workflow.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-request-type">Type</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                defaultValue="bug"
                id="new-request-type"
                name="requestType"
              >
                <option value="bug">Bug</option>
                <option value="feature">Feature</option>
                <option value="content">Content</option>
                <option value="design">Design</option>
                <option value="config">Config</option>
                <option value="ops">Ops</option>
              </select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="new-request-priority">Priority</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                defaultValue="normal"
                id="new-request-priority"
                name="priority"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-request-target-app">
              Target repository{targetRequired ? "" : " (optional)"}
            </Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              id="new-request-target-app"
              name="targetAppId"
              required={targetRequired}
              defaultValue={targetRequired ? targetApps[0]?.id ?? "" : ""}
            >
              {!targetRequired ? (
                <option value="">No repository target</option>
              ) : null}
              {targetApps.map((targetApp) => (
                <option key={targetApp.id} value={targetApp.id}>
                  {targetApp.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-request-description">Description</Label>
            <Textarea
              id="new-request-description"
              name="description"
              placeholder="Describe the issue, expected behavior, and any review constraints."
              required
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border/70 pt-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">
              <FilePlus className="h-4 w-4" />
              Create draft request
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
