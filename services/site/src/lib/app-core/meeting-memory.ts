import { loadConfig } from "./config";

export type MeetingMemoryPromotionResult = {
  ok: boolean;
  memoryPath: string | null;
  artifactUrl: string | null;
  skippedReason: string | null;
  response?: unknown;
};

function memoryWriteKey() {
  return (
    process.env.PRISM_API_WRITE_KEY ??
    process.env.PRISM_API_KEY ??
    ""
  ).trim();
}

function artifactUrlFromPath(pathname: string | null | undefined) {
  const filename = pathname?.trim().split("/").filter(Boolean).at(-1) ?? "";
  const artifactId = filename.replace(/\.json$/i, "");
  if (!artifactId || artifactId === filename) {
    return null;
  }
  const config = loadConfig();
  const baseUrl = (
    process.env.PRISM_ARTIFACT_PUBLIC_BASE_URL ??
    process.env.PRISM_MEMORY_PUBLIC_BASE_URL ??
    config.prismMemoryBaseUrl
  ).trim().replace(/\/+$/, "");
  return baseUrl ? `${baseUrl}/artifacts/${encodeURIComponent(artifactId)}` : null;
}

export function publicMemoryArtifactUrl(pathname: string | null | undefined) {
  return artifactUrlFromPath(pathname);
}

export async function promoteMeetingSummaryToMemory(input: {
  content: string;
  title: string;
  tldr?: string | null;
  source: string;
  sourceId: string | null;
  sourceSystem: string;
  timestamp: string;
  author?: string;
  metadata?: Record<string, unknown>;
}): Promise<MeetingMemoryPromotionResult> {
  const config = loadConfig();
  const baseUrl = config.prismMemoryBaseUrl.trim().replace(/\/+$/, "");
  const writeKey = memoryWriteKey();
  if (!baseUrl || !writeKey) {
    return {
      ok: false,
      memoryPath: null,
      artifactUrl: null,
      skippedReason: "PRISM_MEMORY_BASE_URL or PRISM_API_WRITE_KEY is not configured",
    };
  }

  const response = await fetch(`${baseUrl}/memory/inbox`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Prism-Api-Key": writeKey,
    },
    body: JSON.stringify({
      source: input.source,
      type: "meeting_summary",
      bucket_hint: "meetings",
      content: input.content,
      author: input.author ?? "Prism Recording",
      ts: input.timestamp,
      title: input.title,
      summary: input.tldr ?? undefined,
      metadata: {
        source_system: input.sourceSystem,
        source_type: "meeting_summary",
        source_id: input.sourceId,
        visibility: "internal",
        ...(input.metadata ?? {}),
      },
    }),
  });
  const payload = await response.json().catch(() => null) as { path?: unknown } | null;
  if (!response.ok) {
    throw new Error(`PRISM_MEMORY_INBOX_FAILED:${response.status}:${JSON.stringify(payload ?? {}).slice(0, 300)}`);
  }
  const memoryPath = typeof payload?.path === "string" ? payload.path : null;
  if (!memoryPath) {
    throw new Error("PRISM_MEMORY_INBOX_FAILED:missing_path");
  }
  return {
    ok: true,
    memoryPath,
    artifactUrl: artifactUrlFromPath(memoryPath),
    skippedReason: null,
    response: payload,
  };
}
