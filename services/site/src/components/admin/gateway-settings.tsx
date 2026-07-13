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
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
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
import { plausibleQueryInputSchema } from "@/lib/gateway-presets";
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
  capabilityKeys: string[];
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

type GatewayCapability = {
  key: string;
  driverKey: string;
  connectionId: string | null;
  provider: string;
  description: string;
  enabled: boolean;
  riskLevel: string;
  driverConfig: Record<string, unknown>;
};

type GatewayGrant = {
  id: string;
  subjectType: string;
  subjectId: string;
  capabilityKey: string;
  allowed: boolean;
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
      drivers?: number;
      capabilities?: number;
      toolsets?: number;
      connections?: number;
      auditEvents?: number;
    };
  };
  drivers?: Array<{ key: string; description: string }>;
  connections?: GatewayConnection[];
  toolsets?: GatewayToolset[];
  capabilities?: GatewayCapability[];
  grants?: GatewayGrant[];
  auditEvents?: GatewayAuditEvent[];
};

type ConnectionDraft = {
  provider: string;
  label: string;
  authType: "bearer" | "api-key";
  secretName: string;
  secretValue: string;
};

type CapabilityDraft = {
  key: string;
  connectionId: string;
  description: string;
  baseUrl: string;
  pathTemplate: string;
  method: "GET" | "POST";
  allowedQueryParams: string;
  allowedJsonBodyParams: string;
  staticJsonBody: string;
  authType: "bearer" | "api-key";
  secretName: string;
  headerName: string;
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

const emptyCapability: CapabilityDraft = {
  key: "",
  connectionId: "",
  description: "",
  baseUrl: "",
  pathTemplate: "/",
  method: "GET",
  allowedQueryParams: "",
  allowedJsonBodyParams: "",
  staticJsonBody: "{}",
  authType: "bearer",
  secretName: "apiKey",
  headerName: "X-Api-Key",
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
  const [capabilityDialog, setCapabilityDialog] = useState(false);
  const [capabilityDraft, setCapabilityDraft] = useState(emptyCapability);
  const [testCapability, setTestCapability] =
    useState<GatewayCapability | null>(null);
  const [testInput, setTestInput] = useState("{}");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [grantDialog, setGrantDialog] = useState(false);
  const [grantCapability, setGrantCapability] = useState("");
  const [grantSubjectType, setGrantSubjectType] = useState<
    "runtime" | "service"
  >("runtime");
  const [grantSubjectId, setGrantSubjectId] = useState("codex-default");
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

  function createCapability() {
    const connection = activeConnections.find(
      (item) => item.id === capabilityDraft.connectionId,
    );
    if (!connection) return;
    mutate(async () => {
      let staticJsonBody: Record<string, unknown> = {};
      if (capabilityDraft.method === "POST") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(capabilityDraft.staticJsonBody);
        } catch {
          throw new Error("Fixed JSON body must be valid JSON");
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Fixed JSON body must be a JSON object");
        }
        staticJsonBody = parsed as Record<string, unknown>;
      }
      await adminRequest("/admin/gateway/capabilities", {
        method: "POST",
        body: JSON.stringify({
          key: capabilityDraft.key.trim(),
          driverKey: "http-json.read",
          connectionId: connection.id,
          provider: connection.provider,
          description: capabilityDraft.description.trim(),
          inputSchema:
            capabilityDraft.key.trim() === "plausible.stats.query"
              ? plausibleQueryInputSchema
              : null,
          driverConfig: {
            baseUrl: capabilityDraft.baseUrl.trim(),
            pathTemplate: capabilityDraft.pathTemplate.trim(),
            method: capabilityDraft.method,
            allowedQueryParams:
              capabilityDraft.method === "GET"
                ? capabilityDraft.allowedQueryParams
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean)
                : [],
            allowedJsonBodyParams:
              capabilityDraft.method === "POST"
                ? capabilityDraft.allowedJsonBodyParams
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean)
                : [],
            staticJsonBody,
            auth:
              capabilityDraft.authType === "bearer"
                ? {
                    type: "bearer",
                    secretName: capabilityDraft.secretName.trim(),
                  }
                : {
                    type: "api-key",
                    secretName: capabilityDraft.secretName.trim(),
                    headerName: capabilityDraft.headerName.trim(),
                  },
            timeoutMs: 10000,
            maxResponseBytes: 1000000,
          },
        }),
      });
      setCapabilityDialog(false);
      setCapabilityDraft(emptyCapability);
    });
  }

  function applyPlausiblePreset() {
    setCapabilityDraft((draft) => ({
      ...draft,
      key: "plausible.stats.query",
      description: "Read scoped analytics from the Plausible Stats API.",
      baseUrl: "https://plausible.io",
      pathTemplate: "/api/v2/query",
      method: "POST",
      allowedQueryParams: "",
      allowedJsonBodyParams:
        "site_id, metrics, date_range, dimensions, filters, include, pagination",
      staticJsonBody: "{}",
      authType: "bearer",
      secretName: "apiKey",
    }));
  }

  function toggleCapability(capability: GatewayCapability, enabled: boolean) {
    mutate(async () => {
      await adminRequest(
        `/admin/gateway/capabilities/${encodeURIComponent(capability.key)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        },
      );
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

  function runCapabilityTest() {
    if (!testCapability) return;
    mutate(async () => {
      let input: unknown;
      try {
        input = JSON.parse(testInput);
      } catch {
        throw new Error("Test input must be valid JSON");
      }
      const payload = await adminRequest(
        `/admin/gateway/capabilities/${encodeURIComponent(testCapability.key)}/test`,
        {
          method: "POST",
          body: JSON.stringify({ input }),
        },
      );
      setTestResult(JSON.stringify(payload, null, 2).slice(0, 12000));
    });
  }

  function saveGrant() {
    mutate(async () => {
      const id =
        `${grantSubjectType}-${grantSubjectId}-${grantCapability}`.replace(
          /[^a-zA-Z0-9_.:-]/g,
          "-",
        );
      await adminRequest(`/admin/gateway/grants/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({
          subjectType: grantSubjectType,
          subjectId: grantSubjectId.trim(),
          capabilityKey: grantCapability,
          allowed: true,
          policy: {},
        }),
      });
      setGrantDialog(false);
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
        <div className="grid border border-border/70 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Drivers", overview?.health?.catalog?.drivers ?? 0],
            ["Connections", overview?.health?.catalog?.connections ?? 0],
            ["Toolsets", overview?.health?.catalog?.toolsets ?? 0],
            ["Legacy capabilities", overview?.health?.catalog?.capabilities ?? 0],
            ["Audit events", overview?.health?.catalog?.auditEvents ?? 0],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="border-b border-border/70 p-4 last:border-b-0 sm:border-r sm:[&:nth-child(2n)]:border-r-0 lg:border-b-0 lg:[&:nth-child(2n)]:border-r lg:last:border-r-0"
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
              Import environment
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
                <TableHead>Toolsets</TableHead>
                <TableHead>Legacy capabilities</TableHead>
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
                  <TableCell>{connection.toolsetKeys?.length ?? 0}</TableCell>
                  <TableCell>{connection.capabilityKeys.length}</TableCell>
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
                    colSpan={7}
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
          Toolsets
        </h4>
        <div className="overflow-x-auto border border-border/70">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Toolset</TableHead>
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
                    No toolsets.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="grid gap-3 border-t border-border/60 pt-5">
        <div className="flex items-center justify-between gap-3">
          <h4 className="flex items-center gap-2 font-medium">
            <Link2 className="h-4 w-4" />
            Legacy capabilities
          </h4>
          <Button
            size="sm"
            onClick={() => setCapabilityDialog(true)}
            disabled={!activeConnections.length}
          >
            <Plus />
            Add capability
          </Button>
        </div>
        <div className="overflow-x-auto border border-border/70">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Capability</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(overview?.capabilities ?? []).map((capability) => (
                <TableRow key={capability.key}>
                  <TableCell>
                    <div className="font-medium">{capability.key}</div>
                    <div className="max-w-[360px] truncate text-xs text-muted-foreground">
                      {capability.description}
                    </div>
                  </TableCell>
                  <TableCell>{capability.provider}</TableCell>
                  <TableCell>
                    <div>{capability.driverKey}</div>
                    <div className="text-xs text-muted-foreground">
                      {String(capability.driverConfig.method ?? "GET")}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{capability.riskLevel}</Badge>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={capability.enabled}
                      onCheckedChange={(enabled) =>
                        toggleCapability(capability, enabled)
                      }
                      disabled={isPending}
                      aria-label={`Toggle ${capability.key}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setTestCapability(capability);
                          setTestInput("{}");
                          setTestResult(null);
                        }}
                        disabled={!capability.enabled}
                      >
                        <Play />
                        Test
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!overview?.capabilities?.length ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-20 text-center text-muted-foreground"
                  >
                    No capabilities.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="grid gap-3 border-t border-border/60 pt-5">
        <div className="flex items-center justify-between gap-3">
          <h4 className="flex items-center gap-2 font-medium">
            <ShieldCheck className="h-4 w-4" />
            Grants
          </h4>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setGrantDialog(true)}
            disabled={!overview?.capabilities?.length}
          >
            <Plus />
            Add grant
          </Button>
        </div>
        <div className="overflow-x-auto border border-border/70">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead>Capability</TableHead>
                <TableHead>Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(overview?.grants ?? []).map((grant) => (
                <TableRow key={grant.id}>
                  <TableCell>
                    <div className="font-medium">{grant.subjectId}</div>
                    <div className="text-xs text-muted-foreground">
                      {grant.subjectType}
                    </div>
                  </TableCell>
                  <TableCell>{grant.capabilityKey}</TableCell>
                  <TableCell>
                    <Badge
                      variant={grant.allowed ? "secondary" : "destructive"}
                    >
                      {grant.allowed ? "Allow" : "Deny"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {!overview?.grants?.length ? (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="h-20 text-center text-muted-foreground"
                  >
                    No grants. Invocation is denied by default.
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
                <TableHead>Capability</TableHead>
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
                  <TableCell>{event.capabilityKey}</TableCell>
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
            <DialogTitle>Import Railway environment</DialogTitle>
            <DialogDescription>
              Paste the Codex Runtime environment and review recognized credentials.
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
                      <TableHead>Migration</TableHead>
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
                          <TableCell>
                            <Badge variant={definition.readiness === "ready" ? "secondary" : "outline"}>
                              {definition.readiness === "ready" ? "Ready" : "Adapter required"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!envImportGroups.length ? (
                      <TableRow>
                        <TableCell colSpan={4} className="h-16 text-center text-muted-foreground">
                          No recognized integration credentials.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">Retained configuration: {retainedImportNames.length}</Badge>
                <Badge variant={unknownSensitiveImportNames.length ? "destructive" : "outline"}>
                  Unknown sensitive: {unknownSensitiveImportNames.length}
                </Badge>
              </div>
              {unknownSensitiveImportNames.length ? (
                <div className="text-sm text-destructive">
                  Review before import: {unknownSensitiveImportNames.join(", ")}
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

      <Dialog open={capabilityDialog} onOpenChange={setCapabilityDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add read capability</DialogTitle>
            <DialogDescription>
              Bind a fixed HTTPS JSON endpoint to an encrypted connection.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={applyPlausiblePreset}
            >
              Use Plausible preset
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Capability key</Label>
              <Input
                value={capabilityDraft.key}
                onChange={(event) =>
                  setCapabilityDraft((draft) => ({
                    ...draft,
                    key: event.target.value,
                  }))
                }
                placeholder="analytics.query"
              />
            </div>
            <div className="space-y-2">
              <Label>Connection</Label>
              <Select
                value={capabilityDraft.connectionId}
                onValueChange={(value) =>
                  setCapabilityDraft((draft) => ({
                    ...draft,
                    connectionId: value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select connection" />
                </SelectTrigger>
                <SelectContent>
                  {activeConnections.map((connection) => (
                    <SelectItem key={connection.id} value={connection.id}>
                      {connection.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Description</Label>
              <Input
                value={capabilityDraft.description}
                onChange={(event) =>
                  setCapabilityDraft((draft) => ({
                    ...draft,
                    description: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>HTTPS origin</Label>
              <Input
                value={capabilityDraft.baseUrl}
                onChange={(event) =>
                  setCapabilityDraft((draft) => ({
                    ...draft,
                    baseUrl: event.target.value,
                  }))
                }
                placeholder="https://api.example.org"
              />
            </div>
            <div className="space-y-2">
              <Label>Request method</Label>
              <Select
                value={capabilityDraft.method}
                onValueChange={(value: "GET" | "POST") =>
                  setCapabilityDraft((draft) => ({ ...draft, method: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GET">GET with query parameters</SelectItem>
                  <SelectItem value="POST">POST with JSON body</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Path</Label>
              <Input
                value={capabilityDraft.pathTemplate}
                onChange={(event) =>
                  setCapabilityDraft((draft) => ({
                    ...draft,
                    pathTemplate: event.target.value,
                  }))
                }
              />
            </div>
            {capabilityDraft.method === "GET" ? (
              <div className="space-y-2 sm:col-span-2">
                <Label>Allowed query parameters</Label>
                <Input
                  value={capabilityDraft.allowedQueryParams}
                  onChange={(event) =>
                    setCapabilityDraft((draft) => ({
                      ...draft,
                      allowedQueryParams: event.target.value,
                    }))
                  }
                  placeholder="period, metric"
                />
              </div>
            ) : (
              <>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Fixed JSON body</Label>
                  <Textarea
                    className="min-h-24 font-mono text-xs"
                    value={capabilityDraft.staticJsonBody}
                    onChange={(event) =>
                      setCapabilityDraft((draft) => ({
                        ...draft,
                        staticJsonBody: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Allowed JSON fields</Label>
                  <Input
                    value={capabilityDraft.allowedJsonBodyParams}
                    onChange={(event) =>
                      setCapabilityDraft((draft) => ({
                        ...draft,
                        allowedJsonBodyParams: event.target.value,
                      }))
                    }
                    placeholder="metrics, date_range, dimensions"
                  />
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label>Authentication</Label>
              <Select
                value={capabilityDraft.authType}
                onValueChange={(value: "bearer" | "api-key") =>
                  setCapabilityDraft((draft) => ({ ...draft, authType: value }))
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
                value={capabilityDraft.secretName}
                onChange={(event) =>
                  setCapabilityDraft((draft) => ({
                    ...draft,
                    secretName: event.target.value,
                  }))
                }
              />
            </div>
            {capabilityDraft.authType === "api-key" ? (
              <div className="space-y-2 sm:col-span-2">
                <Label>Header name</Label>
                <Input
                  value={capabilityDraft.headerName}
                  onChange={(event) =>
                    setCapabilityDraft((draft) => ({
                      ...draft,
                      headerName: event.target.value,
                    }))
                  }
                />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCapabilityDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={createCapability}
              disabled={
                isPending ||
                !capabilityDraft.key.trim() ||
                !capabilityDraft.connectionId ||
                !capabilityDraft.description.trim() ||
                !capabilityDraft.baseUrl.trim() ||
                !capabilityDraft.pathTemplate.trim()
              }
            >
              Add capability
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(testCapability)}
        onOpenChange={(open) => {
          if (!open) setTestCapability(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Test {testCapability?.key}</DialogTitle>
            <DialogDescription>
              Run as a Site admin test and record an audit event.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Input JSON</Label>
            <Textarea
              className="min-h-28 font-mono text-xs"
              value={testInput}
              onChange={(event) => setTestInput(event.target.value)}
            />
          </div>
          {testResult ? (
            <pre className="max-h-64 overflow-auto border border-border bg-muted/20 p-3 text-xs">
              {testResult}
            </pre>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestCapability(null)}>
              Close
            </Button>
            <Button onClick={runCapabilityTest} disabled={isPending}>
              <Play />
              Run test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={grantDialog} onOpenChange={setGrantDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add capability grant</DialogTitle>
            <DialogDescription>
              Allow a runtime or service to invoke one capability.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Capability</Label>
              <Select
                value={grantCapability}
                onValueChange={setGrantCapability}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select capability" />
                </SelectTrigger>
                <SelectContent>
                  {(overview?.capabilities ?? []).map((capability) => (
                    <SelectItem key={capability.key} value={capability.key}>
                      {capability.key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Subject type</Label>
                <Select
                  value={grantSubjectType}
                  onValueChange={(value: "runtime" | "service") =>
                    setGrantSubjectType(value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="runtime">Runtime</SelectItem>
                    <SelectItem value="service">Service</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Subject ID</Label>
                <Input
                  value={grantSubjectId}
                  onChange={(event) => setGrantSubjectId(event.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={saveGrant}
              disabled={isPending || !grantCapability || !grantSubjectId.trim()}
            >
              <ShieldCheck />
              Add grant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
