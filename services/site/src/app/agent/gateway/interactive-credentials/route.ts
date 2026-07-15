import { NextResponse } from "next/server";
import {
  isSourceAdapterPlatform,
  loadConfig,
  readSourceAdapterPolicy,
  resolveSourceAdapterPolicy,
} from "@/lib/app-core";
import { credentialsForSourceMode } from "@/lib/gateway-credential-assignment";
import { requireServiceAccess } from "@/lib/internal-service";
import { listEnabledGatewayCredentialsOrEmpty } from "@/lib/prism-gateway";

function stringField(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

export async function POST(request: Request) {
  const access = await requireServiceAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const platform = stringField(body?.platform);
  const targetId = stringField(body?.targetId);
  const userId = stringField(body?.userId);
  if (!platform || !targetId || !userId) {
    return NextResponse.json({ ok: false, error: "SOURCE_IDENTITY_REQUIRED" }, { status: 400 });
  }
  if (!isSourceAdapterPlatform(platform)) {
    return NextResponse.json({ ok: false, error: "SOURCE_PLATFORM_UNSUPPORTED" }, { status: 400 });
  }

  const resolved = resolveSourceAdapterPolicy(readSourceAdapterPolicy(loadConfig()), {
    platform,
    targetId,
    threadId: stringField(body?.threadId) || null,
    groupIds: Array.isArray(body?.groupIds)
      ? body.groupIds.map(stringField).filter(Boolean).slice(0, 100)
      : [],
    userId,
  });
  const credentials = resolved.mode === "full" ? await listEnabledGatewayCredentialsOrEmpty() : [];
  return NextResponse.json({
    ok: true,
    profile: resolved.mode === "full" ? "admin" : resolved.mode === "off" ? "off" : "read",
    accessPolicy: resolved,
    credentials: credentialsForSourceMode(resolved.mode, credentials),
  });
}
