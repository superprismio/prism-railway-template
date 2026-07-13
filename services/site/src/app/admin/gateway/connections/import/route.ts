import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { gatewayEnvImportDefinitions } from "@/lib/gateway-env-import";
import { getPrismGatewayOverview, prismGatewayRequest } from "@/lib/prism-gateway";

type ImportEntry = { key?: unknown; values?: unknown };
type Connection = { id?: unknown; provider?: unknown; status?: unknown };

export async function POST(request: Request) {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null) as { entries?: ImportEntry[] } | null;
  if (!Array.isArray(body?.entries) || body.entries.length === 0 || body.entries.length > 20) {
    return NextResponse.json({ ok: false, error: "Invalid environment import" }, { status: 400 });
  }

  const overview = await getPrismGatewayOverview() as { connections?: Connection[] };
  const connections = Array.isArray(overview.connections) ? overview.connections : [];
  const imported: Array<{ key: string; connectionId: string; action: "created" | "updated" }> = [];
  const failed: Array<{ key: string; error: string }> = [];

  for (const entry of body.entries) {
    const key = typeof entry.key === "string" ? entry.key : "";
    const definition = gatewayEnvImportDefinitions.find((candidate) => candidate.key === key);
    const values = entry.values && typeof entry.values === "object" && !Array.isArray(entry.values)
      ? entry.values as Record<string, unknown>
      : {};
    if (!definition) {
      failed.push({ key, error: "IMPORT_DEFINITION_NOT_FOUND" });
      continue;
    }
    const credentials: Record<string, string> = {};
    for (const [envName, secretName] of Object.entries(definition.credentialVariables)) {
      const value = values[envName];
      if (typeof value === "string" && value) credentials[secretName] = value;
    }
    if (!Object.keys(credentials).length) {
      failed.push({ key, error: "IMPORT_CREDENTIALS_MISSING" });
      continue;
    }
    try {
      const existing = connections.find(
        (connection) => connection.provider === definition.provider && connection.status !== "revoked",
      );
      if (typeof existing?.id === "string") {
        await prismGatewayRequest(`/connections/${encodeURIComponent(existing.id)}/credentials`, {
          method: "PUT",
          body: JSON.stringify({ credentials }),
        });
        imported.push({ key, connectionId: existing.id, action: "updated" });
      } else {
        const result = await prismGatewayRequest<{ connection?: { id?: unknown } }>("/connections", {
          method: "POST",
          body: JSON.stringify({
            provider: definition.provider,
            label: definition.label,
            authType: definition.authType,
            credentials,
          }),
        });
        const connectionId = typeof result.connection?.id === "string" ? result.connection.id : "";
        if (!connectionId) throw new Error("CONNECTION_CREATE_RESPONSE_INVALID");
        imported.push({ key, connectionId, action: "created" });
      }
    } catch (error) {
      failed.push({ key, error: error instanceof Error ? error.message : "IMPORT_FAILED" });
    }
  }

  return NextResponse.json({ ok: failed.length === 0, imported, failed }, { status: failed.length ? 207 : 200 });
}
