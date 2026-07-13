"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  gatewayEnvImportDefinitions,
  parseEnvText,
  retainedGatewayEnvVariables,
} from "@/lib/gateway-env-import";

type GatewayConnection = {
  id: string;
  provider: string;
  label: string;
  authType: string;
  status: string;
  toolsetKeys: string[];
  secretNames: string[];
  lastUsedAt: string | null;
};

type GatewayToolset = {
  key: string;
  connectionId: string;
  protocol: "openapi" | "mcp" | "http" | "adapter";
  description: string;
  enabled: boolean;
  lastDiscoveredAt: string | null;
  discoveryError: string | null;
};

type GatewayAuditEvent = {
  id: string;
  traceId: string;
  capabilityKey: string;
  authenticatedCallerId: string;
  status: string;
  policyDecision: string;
  latencyMs: number | null;
  errorCode: string | null;
  createdAt: string;
};

type GatewayOverview = {
  enabled: boolean;
  configured: boolean;
  reachable: boolean;
  health?: {
    database?: { ok?: boolean; migrations?: number };
    catalog?: {
      toolsets?: number;
      connections?: number;
      auditEvents?: number;
    };
  };
  connections?: GatewayConnection[];
  toolsets?: GatewayToolset[];
  auditEvents?: GatewayAuditEvent[];
};

type ConnectionDraft = {
  provider: string;
  label: string;
  authType: "bearer" | "api-key";
  secretName: string;
  secretValue: string;
};

type PendingCredentialDraft = {
  secretName: string;
  value: string;
  email: string;
  password: string;
};

const emptyConnection: ConnectionDraft = {
  provider: "",
  label: "",
  authType: "bearer",
  secretName: "apiKey",
  secretValue: "",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

async function adminRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok || body.ok === false) {
    throw new Error(
      typeof body.error === "string" ? body.error : "Gateway request failed",
    );
  }
  return body;
}

function statusVariant(status: string) {
  if (status === "healthy" || status === "leased" || status === "succeeded" || status === "allowed")
    return "secondary" as const;
  if (status === "failed" || status === "denied" || status === "unhealthy")
    return "destructive" as const;
  return "outline" as const;
}

function connectionStatusLabel(status: string) {
  if (status === "healthy") return "Verified";
  if (status === "leased") return "Lease used";
  if (status === "untested") return "Not verified";
  if (status === "unhealthy") return "Failed";
  if (status === "revoked") return "Revoked";
  return status;
}

function auditSubjectLabel(value: string) {
  return value.startsWith("toolset:") ? value.slice("toolset:".length) : value;
}

export function GatewaySettings() {
  const searchParams = useSearchParams();
  const [overview, setOverview] = useState<GatewayOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [connectionDialog, setConnectionDialog] = useState(false);
  const [connectionDraft, setConnectionDraft] = useState(emptyConnection);
  const [replaceConnection, setReplaceConnection] =
    useState<GatewayConnection | null>(null);
  const [replacementValue, setReplacementValue] = useState("");
  const [replacementEmail, setReplacementEmail] = useState("");
  const [replacementPassword, setReplacementPassword] = useState("");
  const [credentialBatchDialog, setCredentialBatchDialog] = useState(false);
  const [credentialBatch, setCredentialBatch] = useState<
    Record<string, PendingCredentialDraft>
  >({});
  const [envImportDialog, setEnvImportDialog] = useState(false);
  const [envImportText, setEnvImportText] = useState("");
  const [revokeConnection, setRevokeConnection] =
    useState<GatewayConnection | null>(null);
  const [focusedConnectionId, setFocusedConnectionId] = useState<string | null>(null);
  const handledCredentialTarget = useRef("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const payload = (await adminRequest("/admin/gateway")) as {
        gateway?: GatewayOverview;
      };
      setOverview(payload.gateway ?? null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load Gateway",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeConnections = useMemo(
    () =>
      (overview?.connections ?? []).filter(
        (connection) => connection.status !== "revoked",
      ),
    [overview?.connections],
  );
  const incompleteConnections = useMemo(
    () => activeConnections.filter((connection) => connection.secretNames.length === 0),
    [activeConnections],
  );
  const parsedEnvImport = useMemo(() => parseEnvText(envImportText), [envImportText]);
  const envImportGroups = useMemo(
    () => gatewayEnvImportDefinitions.filter((definition) =>
      Object.keys(definition.credentialVariables).some((name) => parsedEnvImport[name]),
    ),
    [parsedEnvImport],
  );
  const classifiedEnvNames = useMemo(
    () => new Set(gatewayEnvImportDefinitions.flatMap((definition) => [
      ...Object.keys(definition.credentialVariables),
      ...definition.configurationVariables,
    ])),
    [],
  );
  const retainedImportNames = Object.keys(parsedEnvImport).filter((name) =>
    retainedGatewayEnvVariables.has(name) || gatewayEnvImportDefinitions.some(
      (definition) => definition.configurationVariables.includes(name),
    ),
  );
  const unknownSensitiveImportNames = Object.keys(parsedEnvImport).filter(
    (name) =>
      /(KEY|TOKEN|SECRET|PASSWORD|PRIVATE)/.test(name) &&
      !classifiedEnvNames.has(name) &&
      !retainedGatewayEnvVariables.has(name) &&
      name !== "PRISM_RUNTIME_KEY" &&
      !name.startsWith("RAILWAY_"),
  );

  const requestedConnectionId = searchParams.get("connection")?.trim() || "";
  const requestedConnectionAction = searchParams.get("action")?.trim() || "";
  const requestedSecretName = searchParams.get("secretName")?.trim() || "";

  useEffect(() => {
    if (!requestedConnectionId || !overview?.connections?.length) return;
    const connection = overview.connections.find((item) => item.id === requestedConnectionId);
    if (!connection) return;
    setFocusedConnectionId(connection.id);
    requestAnimationFrame(() => {
      document.getElementById(`gateway-connection-${connection.id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    const targetKey = `${connection.id}:${requestedConnectionAction}:${requestedSecretName}`;
    if (requestedConnectionAction === "credential" && handledCredentialTarget.current !== targetKey) {
      handledCredentialTarget.current = targetKey;
      setReplaceConnection(connection);
    }
  }, [overview?.connections, requestedConnectionAction, requestedConnectionId, requestedSecretName]);

  function mutate(action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        await load();
      } catch (mutationError) {
        setError(
          mutationError instanceof Error
            ? mutationError.message
            : "Gateway update failed",
        );
      }
    });
  }

  function createConnection() {
    mutate(async () => {
      await adminRequest("/admin/gateway/connections", {
        method: "POST",
        body: JSON.stringify({
          provider: connectionDraft.provider.trim(),
          label: connectionDraft.label.trim(),
          authType: connectionDraft.authType,
          credentials: {
            [connectionDraft.secretName.trim()]: connectionDraft.secretValue,
          },
        }),
      });
      setConnectionDialog(false);
      setConnectionDraft(emptyConnection);
    });
  }

  function replaceCredentials() {
    if (!replaceConnection) return;
    mutate(async () => {
      const payloadLogin = replaceConnection.authType === "payload-login";
      const secretName = replaceConnection.id === requestedConnectionId && requestedSecretName
        ? requestedSecretName
        : replaceConnection.secretNames[0] || "apiKey";
      await adminRequest(
        `/admin/gateway/connections/${encodeURIComponent(replaceConnection.id)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            credentials: payloadLogin
              ? { email: replacementEmail, password: replacementPassword }
              : { [secretName]: replacementValue },
          }),
        },
      );
      setReplaceConnection(null);
      setReplacementValue("");
      setReplacementEmail("");
      setReplacementPassword("");
    });
  }

  function openCredentialBatch() {
    setCredentialBatch(
      Object.fromEntries(
        incompleteConnections.map((connection) => [
          connection.id,
          {
            secretName: connection.secretNames[0] || "apiKey",
            value: "",
            email: "",
            password: "",
          },
        ]),
      ),
    );
    setCredentialBatchDialog(true);
  }

  function completeCredentialBatch() {
    mutate(async () => {
      await adminRequest("/admin/gateway/connections/credentials/batch", {
        method: "POST",
        body: JSON.stringify({
          entries: incompleteConnections.map((connection) => {
            const draft = credentialBatch[connection.id];
            return {
              connectionId: connection.id,
              credentials:
                connection.authType === "payload-login"
                  ? { email: draft.email, password: draft.password }
                  : { [draft.secretName.trim()]: draft.value },
            };
          }),
        }),
      });
      setCredentialBatch({});
      setCredentialBatchDialog(false);
    });
  }

  function importEnvironment() {
    mutate(async () => {
      await adminRequest("/admin/gateway/connections/import", {
        method: "POST",
        body: JSON.stringify({
          entries: envImportGroups.map((definition) => ({
            key: definition.key,
            values: Object.fromEntries(
              Object.keys(definition.credentialVariables)
                .filter((name) => parsedEnvImport[name])
                .map((name) => [name, parsedEnvImport[name]]),
            ),
          })),
        }),
      });
      setEnvImportText("");
      setEnvImportDialog(false);
    });
  }

  const credentialBatchComplete = incompleteConnections.every((connection) => {
    const draft = credentialBatch[connection.id];
    if (!draft) return false;
    return connection.authType === "payload-login"
      ? Boolean(draft.email.trim() && draft.password)
      : Boolean(draft.secretName.trim() && draft.value);
  });

  function confirmRevokeConnection() {
    if (!revokeConnection) return;
    mutate(async () => {
      await adminRequest(
        `/admin/gateway/connections/${encodeURIComponent(revokeConnection.id)}`,
        { method: "DELETE" },
      );
      setRevokeConnection(null);
    });
  }

  function toggleToolset(toolset: GatewayToolset, enabled: boolean) {
    mutate(async () => {
      await adminRequest(
        `/admin/gateway/toolsets/${encodeURIComponent(toolset.key)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        },
      );
    });
  }

  if (!overview && !error) {
    return (
      <div className="h-32 animate-pulse border border-border/60 bg-muted/20" />
    );
  }

  return (
    <div className="grid gap-6">
      {error ? (
        <div className="border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <section className="border-y border-border/60 py-4">
        <p className="text-sm text-muted-foreground">
          Store credentials securely here. Use Prism Console to configure connected
          services.
        </p>
      </section>

      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="flex items-center gap-2 font-medium">
            <Activity className="h-4 w-4" />
            Status
          </h4>
          <div className="flex items-center gap-2">
            <Badge variant={overview?.reachable ? "secondary" : "destructive"}>
              {overview?.reachable
                ? "Online"
                : overview?.enabled
                  ? "Unavailable"
                  : "Disabled"}
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={isPending}
              title="Refresh Gateway"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
        <div className="grid border border-border/70 sm:grid-cols-3">
          {[
            ["Connections", overview?.health?.catalog?.connections ?? 0],
            ["Connected services", overview?.health?.catalog?.toolsets ?? 0],
            ["Audit events", overview?.health?.catalog?.auditEvents ?? 0],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="border-b border-border/70 p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
            >
              <p className="text-xs font-medium uppercase text-muted-foreground">
                {label}
              </p>
              <p className="mt-1 text-2xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3 border-t border-border/60 pt-5">
        <div className="flex items-center justify-between gap-3">
          <h4 className="flex items-center gap-2 font-medium">
            <KeyRound className="h-4 w-4" />
            Connections
          </h4>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEnvImportDialog(true)}
              disabled={!overview?.reachable}
            >
              <Upload />
              Migrate existing secrets
            </Button>
            {incompleteConnections.length ? (
              <Button
                size="sm"
                variant="outline"
                onClick={openCredentialBatch}
                disabled={!overview?.reachable}
              >
                <KeyRound />
                Complete setup ({incompleteConnections.length})
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => setConnectionDialog(true)}
              disabled={!overview?.reachable}
            >
              <Plus />
              Add connection
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto border border-border/70">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Connection</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Connected services</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(overview?.connections ?? []).map((connection) => (
                <TableRow
                  key={connection.id}
                  id={`gateway-connection-${connection.id}`}
                  className={focusedConnectionId === connection.id ? "bg-accent/40" : undefined}
                >
                  <TableCell>
                    <div className="font-medium">{connection.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {connection.authType}
                    </div>
                  </TableCell>
                  <TableCell>{connection.provider}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(connection.status)}>
                      {connectionStatusLabel(connection.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {connection.toolsetKeys?.length
                      ? connection.toolsetKeys.join(", ")
                      : "Not connected"}
                  </TableCell>
                  <TableCell>{formatDate(connection.lastUsedAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="icon"
                        variant="outline"
                        title="Replace credential"
                        disabled={connection.status === "revoked"}
                        onClick={() => setReplaceConnection(connection)}
                      >
                        <KeyRound />
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        title="Revoke connection"
                        disabled={connection.status === "revoked"}
                        onClick={() => setRevokeConnection(connection)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!overview?.connections?.length ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-20 text-center text-muted-foreground"
                  >
                    No connections.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="grid gap-3 border-t border-border/60 pt-5">
        <h4 className="flex items-center gap-2 font-medium">
          <Link2 className="h-4 w-4" />
          Connected services
        </h4>
        <div className="overflow-x-auto border border-border/70">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Connection</TableHead>
                <TableHead>Protocol</TableHead>
                <TableHead>Discovery</TableHead>
                <TableHead>Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(overview?.toolsets ?? []).map((toolset) => {
                const connection = overview?.connections?.find(
                  (candidate) => candidate.id === toolset.connectionId,
                );
                return (
                  <TableRow key={toolset.key}>
                    <TableCell>
                      <div className="font-medium">{toolset.key}</div>
                      <div className="max-w-[360px] truncate text-xs text-muted-foreground">
                        {toolset.description}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>{connection?.label ?? toolset.connectionId}</div>
                      {connection ? (
                        <div className="text-xs text-muted-foreground">
                          {connection.provider}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{toolset.protocol}</Badge>
                    </TableCell>
                    <TableCell>
                      {toolset.discoveryError ? (
                        <Badge variant="destructive">Failed</Badge>
                      ) : toolset.lastDiscoveredAt ? (
                        formatDate(toolset.lastDiscoveredAt)
                      ) : toolset.protocol === "openapi" || toolset.protocol === "mcp" ? (
                        "Not run"
                      ) : (
                        "Not required"
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={toolset.enabled}
                        onCheckedChange={(enabled) => toggleToolset(toolset, enabled)}
                        disabled={isPending || connection?.status === "revoked"}
                        aria-label={`Toggle ${toolset.key}`}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {!overview?.toolsets?.length ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-20 text-center text-muted-foreground"
                  >
                    No connected services.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="grid gap-3 border-t border-border/60 pt-5">
        <h4 className="flex items-center gap-2 font-medium">
          <Activity className="h-4 w-4" />
          Recent audit
        </h4>
        <div className="overflow-x-auto border border-border/70">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Service or action</TableHead>
                <TableHead>Caller</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Decision</TableHead>
                <TableHead>Latency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(overview?.auditEvents ?? []).map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(event.createdAt)}
                  </TableCell>
                  <TableCell>{auditSubjectLabel(event.capabilityKey)}</TableCell>
                  <TableCell>{event.authenticatedCallerId}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(event.status)}>
                      {event.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {event.errorCode ?? event.policyDecision}
                  </TableCell>
                  <TableCell>
                    {event.latencyMs === null ? "-" : `${event.latencyMs} ms`}
                  </TableCell>
                </TableRow>
              ))}
              {!overview?.auditEvents?.length ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-20 text-center text-muted-foreground"
                  >
                    No audit events.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>

      <Dialog open={connectionDialog} onOpenChange={setConnectionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add connection</DialogTitle>
            <DialogDescription>
              Store an encrypted provider credential.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Label</Label>
              <Input
                value={connectionDraft.label}
                onChange={(event) =>
                  setConnectionDraft((draft) => ({
                    ...draft,
                    label: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Provider</Label>
              <Input
                value={connectionDraft.provider}
                onChange={(event) =>
                  setConnectionDraft((draft) => ({
                    ...draft,
                    provider: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Authentication</Label>
              <Select
                value={connectionDraft.authType}
                onValueChange={(value: "bearer" | "api-key") =>
                  setConnectionDraft((draft) => ({ ...draft, authType: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bearer">Bearer token</SelectItem>
                  <SelectItem value="api-key">API key header</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Secret name</Label>
              <Input
                value={connectionDraft.secretName}
                onChange={(event) =>
                  setConnectionDraft((draft) => ({
                    ...draft,
                    secretName: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Credential</Label>
              <Input
                type="password"
                autoComplete="new-password"
                value={connectionDraft.secretValue}
                onChange={(event) =>
                  setConnectionDraft((draft) => ({
                    ...draft,
                    secretValue: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConnectionDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={createConnection}
              disabled={
                isPending ||
                !connectionDraft.label.trim() ||
                !connectionDraft.provider.trim() ||
                !connectionDraft.secretName.trim() ||
                !connectionDraft.secretValue
              }
            >
              Add connection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={envImportDialog}
        onOpenChange={(open) => {
          setEnvImportDialog(open);
          if (!open) setEnvImportText("");
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Migrate existing secrets</DialogTitle>
            <DialogDescription>
              Paste an environment block copied from the existing runtime. Recognized
              credentials are encrypted in Gateway connections; Railway variables and
              non-secret configuration are not changed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Environment</Label>
            <Textarea
              className="min-h-48 font-mono text-xs"
              value={envImportText}
              onChange={(event) => setEnvImportText(event.target.value)}
              placeholder="NAME=value"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {envImportText ? (
            <div className="space-y-3">
              <div className="overflow-x-auto border border-border/70">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Integration</TableHead>
                      <TableHead>Credentials</TableHead>
                      <TableHead>Connection</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {envImportGroups.map((definition) => {
                      const credentialNames = Object.keys(definition.credentialVariables)
                        .filter((name) => parsedEnvImport[name]);
                      const existing = activeConnections.find(
                        (connection) => connection.provider === definition.provider,
                      );
                      return (
                        <TableRow key={definition.key}>
                          <TableCell>
                            <div className="font-medium">{definition.label}</div>
                            <div className="text-xs text-muted-foreground">{definition.key}</div>
                          </TableCell>
                          <TableCell>{credentialNames.length}</TableCell>
                          <TableCell>{existing ? "Update" : "Create"}</TableCell>
                        </TableRow>
                      );
                    })}
                    {!envImportGroups.length ? (
                      <TableRow>
                        <TableCell colSpan={3} className="h-16 text-center text-muted-foreground">
                          No recognized integration credentials.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">Configuration left in runtime: {retainedImportNames.length}</Badge>
                <Badge variant={unknownSensitiveImportNames.length ? "destructive" : "outline"}>
                  Unsupported secret variables: {unknownSensitiveImportNames.length}
                </Badge>
              </div>
              {unknownSensitiveImportNames.length ? (
                <div className="text-sm text-destructive">
                  Remove unsupported secret variables before importing: {unknownSensitiveImportNames.join(", ")}
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnvImportDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={importEnvironment}
              disabled={isPending || !envImportGroups.length || Boolean(unknownSensitiveImportNames.length)}
            >
              Import credentials
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(replaceConnection)}
        onOpenChange={(open) => {
          if (!open) setReplaceConnection(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace credential</DialogTitle>
            <DialogDescription>{replaceConnection?.label}</DialogDescription>
          </DialogHeader>
          {replaceConnection?.authType === "payload-login" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  autoComplete="username"
                  value={replacementEmail}
                  onChange={(event) => setReplacementEmail(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={replacementPassword}
                  onChange={(event) => setReplacementPassword(event.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>New credential</Label>
              <Input
                type="password"
                autoComplete="new-password"
                value={replacementValue}
                onChange={(event) => setReplacementValue(event.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReplaceConnection(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={replaceCredentials}
              disabled={isPending || (replaceConnection?.authType === "payload-login"
                ? !replacementEmail || !replacementPassword
                : !replacementValue)}
            >
              Replace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={credentialBatchDialog}
        onOpenChange={(open) => {
          setCredentialBatchDialog(open);
          if (!open) setCredentialBatch({});
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Complete gateway setup</DialogTitle>
            <DialogDescription>
              Add credentials for pending connections.
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y divide-border border-y border-border">
            {incompleteConnections.map((connection) => {
              const draft = credentialBatch[connection.id];
              if (!draft) return null;
              return (
                <div key={connection.id} className="grid gap-3 py-4">
                  <div>
                    <div className="font-medium">{connection.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {connection.provider}
                    </div>
                  </div>
                  {connection.authType === "payload-login" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Email</Label>
                        <Input
                          type="email"
                          autoComplete="username"
                          value={draft.email}
                          onChange={(event) =>
                            setCredentialBatch((current) => ({
                              ...current,
                              [connection.id]: { ...draft, email: event.target.value },
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Password</Label>
                        <Input
                          type="password"
                          autoComplete="current-password"
                          value={draft.password}
                          onChange={(event) =>
                            setCredentialBatch((current) => ({
                              ...current,
                              [connection.id]: { ...draft, password: event.target.value },
                            }))
                          }
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                      <div className="space-y-2">
                        <Label>Secret name</Label>
                        <Input
                          value={draft.secretName}
                          onChange={(event) =>
                            setCredentialBatch((current) => ({
                              ...current,
                              [connection.id]: { ...draft, secretName: event.target.value },
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Credential</Label>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          value={draft.value}
                          onChange={(event) =>
                            setCredentialBatch((current) => ({
                              ...current,
                              [connection.id]: { ...draft, value: event.target.value },
                            }))
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCredentialBatchDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={completeCredentialBatch}
              disabled={isPending || !credentialBatchComplete}
            >
              Save credentials
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(revokeConnection)}
        onOpenChange={(open) => {
          if (!open) setRevokeConnection(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke connection</DialogTitle>
            <DialogDescription>{revokeConnection?.label}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeConnection(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmRevokeConnection}
              disabled={isPending}
            >
              <Trash2 />
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
