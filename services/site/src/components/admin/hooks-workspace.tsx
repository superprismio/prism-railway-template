"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ChevronDown, Copy, Play, RefreshCw, Trash2, Webhook } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { HookRecord } from "@/lib/app-core";

type HooksPayload = {
  ok: boolean;
  hooks?: HookRecord[];
  error?: string;
};

type TriggerPayload = {
  ok: boolean;
  changeRequest?: {
    requestNumber?: number;
    title?: string;
  };
  autoStart?: {
    started?: boolean;
    reason?: string;
  } | null;
  error?: string;
};

function formatTimestamp(value: string | null) {
  if (!value) return "Not triggered";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function endpointForHook(key: string) {
  return `/agent/hooks/${encodeURIComponent(key)}/trigger`;
}

export function HooksWorkspace() {
  const [hooks, setHooks] = useState<HookRecord[]>([]);
  const [payloads, setPayloads] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function loadHooks() {
    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch("/admin/hooks", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as HooksPayload;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "Could not load hooks");
        }
        setHooks(payload.hooks ?? []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Could not load hooks");
      }
    });
  }

  useEffect(() => {
    loadHooks();
  }, []);

  const customHooks = useMemo(() => hooks.filter((hook) => !hook.systemDefault), [hooks]);
  const systemHooks = useMemo(() => hooks.filter((hook) => hook.systemDefault), [hooks]);

  function updateHook(hook: HookRecord, update: Partial<HookRecord>) {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      try {
        const response = await fetch(`/admin/hooks/${encodeURIComponent(hook.key)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
        });
        const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; hook?: HookRecord; error?: string };
        if (!response.ok || !payload.ok || !payload.hook) {
          throw new Error(payload.error || "Could not update hook");
        }
        setHooks((current) => current.map((item) => (item.key === hook.key ? payload.hook as HookRecord : item)));
      } catch (updateError) {
        setError(updateError instanceof Error ? updateError.message : "Could not update hook");
      }
    });
  }

  function deleteHook(hook: HookRecord) {
    if (hook.systemDefault) return;
    startTransition(async () => {
      setError(null);
      setMessage(null);
      try {
        const response = await fetch(`/admin/hooks/${encodeURIComponent(hook.key)}`, { method: "DELETE" });
        const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "Could not delete hook");
        }
        setHooks((current) => current.filter((item) => item.key !== hook.key));
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : "Could not delete hook");
      }
    });
  }

  function triggerHook(hook: HookRecord) {
    const rawPayload = payloads[hook.key]?.trim() || "{}";
    let parsedPayload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawPayload) as unknown;
      parsedPayload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      setError("Test payload must be valid JSON");
      return;
    }

    startTransition(async () => {
      setError(null);
      setMessage(null);
      try {
        const response = await fetch(`/admin/hooks/${encodeURIComponent(hook.key)}/trigger`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsedPayload),
        });
        const payload = (await response.json().catch(() => ({}))) as TriggerPayload;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "Could not trigger hook");
        }
        setMessage(
          `Created request #${payload.changeRequest?.requestNumber ?? "?"}: ${payload.changeRequest?.title ?? hook.name}`,
        );
        loadHooks();
      } catch (triggerError) {
        setError(triggerError instanceof Error ? triggerError.message : "Could not trigger hook");
      }
    });
  }

  function copyEndpoint(hook: HookRecord) {
    void navigator.clipboard?.writeText(endpointForHook(hook.key));
    setMessage(`Copied ${endpointForHook(hook.key)}`);
  }

  function renderHook(hook: HookRecord) {
    return (
      <div key={hook.id} className="border border-border bg-card/70 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{hook.name}</h3>
              <Badge variant="outline">{hook.key}</Badge>
              <Badge variant={hook.enabled ? "secondary" : "muted"}>{hook.enabled ? "Enabled" : "Disabled"}</Badge>
              {hook.systemDefault ? <Badge variant="outline">Built-in</Badge> : null}
            </div>
            <p className="text-sm text-muted-foreground">{hook.description || "No description."}</p>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>Workflow: {hook.workflowKey}</span>
              <span>Auth: {hook.authMode}</span>
              <span>Last trigger: {formatTimestamp(hook.lastTriggeredAt)}</span>
            </div>
            <code className="block break-all border border-border bg-background p-2 text-xs">
              POST {endpointForHook(hook.key)}
            </code>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={hook.enabled} onCheckedChange={(enabled) => updateHook(hook, { enabled })} disabled={isPending} />
            <Button type="button" variant="outline" size="icon" onClick={() => copyEndpoint(hook)} title="Copy endpoint">
              <Copy className="h-4 w-4" />
            </Button>
            {!hook.systemDefault ? (
              <Button type="button" variant="outline" size="icon" onClick={() => deleteHook(hook)} title="Delete hook">
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Test Payload
          </label>
          <Textarea
            value={payloads[hook.key] ?? "{}"}
            onChange={(event) => setPayloads((current) => ({ ...current, [hook.key]: event.target.value }))}
            rows={4}
            className="font-mono text-xs"
          />
          <Button type="button" onClick={() => triggerHook(hook)} disabled={isPending || !hook.enabled}>
            <Play className="mr-2 h-4 w-4" />
            Test trigger
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Workflow Hooks</h2>
          <p className="text-sm text-muted-foreground">
            On-demand entrypoints that create workflow-backed requests.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={loadHooks} disabled={isPending}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {error ? <div className="border border-destructive bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
      {message ? <div className="border border-border bg-background p-3 text-sm">{message}</div> : null}

      <Collapsible defaultOpen>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" className="mb-3 gap-2 px-0">
            <ChevronDown className="h-4 w-4" />
            Custom hooks ({customHooks.length})
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3">
          {customHooks.length ? customHooks.map(renderHook) : (
            <div className="border border-border bg-card/70 p-6 text-sm text-muted-foreground">
              <Webhook className="mb-3 h-5 w-5" />
              No custom hooks registered.
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {systemHooks.length ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" className="mb-3 gap-2 px-0">
              <ChevronDown className="h-4 w-4" />
              Built-in hooks ({systemHooks.length})
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3">
            {systemHooks.map(renderHook)}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}
