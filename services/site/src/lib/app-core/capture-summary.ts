import {
  getCaptureManifest,
  markCaptureSummaryFailed,
  markCaptureSummaryPending,
  readCaptureTranscriptFiles,
  updateCaptureSummaryMemory,
  writeCaptureSummaryFiles,
  type CaptureManifest,
} from "./capture-storage";
import { loadConfig } from "./config";
import { promoteMeetingSummaryToMemory, type MeetingMemoryPromotionResult } from "./meeting-memory";
import { readRecordingSummaryProfile } from "./recording-summary-profile";

type RuntimeResponsePayload = {
  responseText?: string | null;
  output_text?: string | null;
  error?: string | null;
  jobId?: string | null;
  job?: {
    status?: string | null;
    response?: RuntimeResponsePayload | null;
    error?: string | null;
    threadId?: string | null;
  } | null;
  response?: RuntimeResponsePayload | null;
};

export type CaptureSummary = {
  title: string;
  tldr: string;
  summary: string;
  actionItems: Array<{
    name: string;
    description: string;
    assignedTo: string | null;
    dueDate: string | null;
    params: Record<string, string>;
  }>;
  notableQuotes: Array<{
    author: string;
    quote: string;
    paraphrase: string;
  }>;
  tags: string[];
  memory?: MeetingMemoryPromotionResult | null;
  raw?: unknown;
};

function runtimeTimeoutMs() {
  const milliseconds = Number.parseInt(process.env.CODEX_RUNTIME_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(milliseconds) && milliseconds > 0) return milliseconds;
  const seconds = Number.parseInt(process.env.CODEX_RUNTIME_REQUEST_TIMEOUT_SECONDS ?? "", 10);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return 660_000;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function runtimeResponseText(payload: RuntimeResponsePayload | null | undefined) {
  return typeof payload?.responseText === "string" && payload.responseText.trim()
    ? payload.responseText.trim()
    : typeof payload?.output_text === "string" && payload.output_text.trim()
      ? payload.output_text.trim()
      : "";
}

export async function codexRuntimeRequest(input: {
  prompt: string;
  captureId: string;
  metadata: Record<string, unknown>;
  sessionId?: string;
}) {
  const config = loadConfig();
  if (!config.codexRuntimeBaseUrl) {
    throw new Error("CODEX_RUNTIME_BASE_URL_MISSING");
  }

  const runtimeInput = {
    prompt: input.prompt,
    sessionId: input.sessionId ?? `capture-summary-${input.captureId}`,
    codexThreadId: null,
    recentHistory: [],
    metadata: input.metadata,
  };
  const timeoutMs = runtimeTimeoutMs();
  const startedAt = Date.now();
  const remainingTimeoutMs = () => Math.max(1, timeoutMs - (Date.now() - startedAt));
  const jobsUrl = `${config.codexRuntimeBaseUrl}/v1/responses/jobs`;
  const responseUrl = `${config.codexRuntimeBaseUrl}/v1/responses`;
  let jobId: string | null = null;

  try {
    const submitResponse = await fetchWithTimeout(jobsUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(runtimeInput),
    }, Math.min(30_000, timeoutMs));
    if (submitResponse.status !== 404) {
      const submitPayload = await submitResponse.json().catch(() => null) as RuntimeResponsePayload | null;
      if (!submitResponse.ok) {
        throw new Error(`CODEX_RUNTIME_JOB_CREATE_FAILED:${submitResponse.status}:${String(submitPayload?.error ?? "").slice(0, 300)}`);
      }
      jobId = typeof submitPayload?.jobId === "string" ? submitPayload.jobId : null;
      if (!jobId) {
        throw new Error("CODEX_RUNTIME_JOB_CREATE_INVALID_RESPONSE");
      }
      const pollUrl = `${jobsUrl}/${encodeURIComponent(jobId)}`;
      for (;;) {
        if (Date.now() - startedAt >= timeoutMs) {
          throw new Error(`CODEX_RUNTIME_REQUEST_TIMEOUT:${timeoutMs}`);
        }
        await sleep(2000);
        const pollResponse = await fetchWithTimeout(pollUrl, { cache: "no-store" }, Math.min(30_000, remainingTimeoutMs()));
        const pollPayload = await pollResponse.json().catch(() => null) as RuntimeResponsePayload | null;
        if (!pollResponse.ok) {
          throw new Error(`CODEX_RUNTIME_JOB_POLL_FAILED:${pollResponse.status}:${String(pollPayload?.error ?? "").slice(0, 300)}`);
        }
        const status = typeof pollPayload?.job?.status === "string" ? pollPayload.job.status : "";
        if (status === "queued" || status === "running") continue;
        if (status === "succeeded") {
          const text = runtimeResponseText(pollPayload?.response ?? pollPayload?.job?.response ?? null);
          if (!text) throw new Error("CODEX_RUNTIME_EMPTY_RESPONSE");
          return text;
        }
        throw new Error(`CODEX_RUNTIME_REQUEST_FAILED:500:${String(pollPayload?.error ?? pollPayload?.job?.error ?? "Unknown codex runtime error").slice(0, 300)}`);
      }
    }
  } catch (error) {
    if (jobId) throw error;
    console.warn(JSON.stringify({
      event: "capture_summary.codex_runtime_job_path_unavailable",
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  const response = await fetchWithTimeout(responseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(runtimeInput),
  }, remainingTimeoutMs());
  const payload = await response.json().catch(() => null) as RuntimeResponsePayload | null;
  if (!response.ok) {
    throw new Error(`CODEX_RUNTIME_REQUEST_FAILED:${response.status}:${String(payload?.error ?? "Unknown codex runtime error").slice(0, 300)}`);
  }
  const text = runtimeResponseText(payload);
  if (!text) {
    throw new Error("CODEX_RUNTIME_EMPTY_RESPONSE");
  }
  return text;
}

export function safeJsonParse(input: string) {
  const cleaned = input
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("CAPTURE_SUMMARY_JSON_PARSE_FAILED");
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringOrNull(value: unknown) {
  const normalized = stringValue(value);
  return normalized || null;
}

function normalizeActionItems(value: unknown): CaptureSummary["actionItems"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      name: stringValue(item.name) || "Action item",
      description: stringValue(item.description),
      assignedTo: stringOrNull(item.assignedTo),
      dueDate: stringOrNull(item.dueDate),
      params: item.params && typeof item.params === "object" && !Array.isArray(item.params)
        ? Object.fromEntries(Object.entries(item.params).map(([key, value]) => [key, String(value)]))
        : {},
    }));
}

function normalizeQuotes(value: unknown): CaptureSummary["notableQuotes"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      author: stringValue(item.author) || "Unknown",
      quote: stringValue(item.quote),
      paraphrase: stringValue(item.paraphrase),
    }))
    .filter((item) => item.quote || item.paraphrase);
}

function normalizeTags(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter(Boolean).slice(0, 12)
    : [];
}

function normalizeSummary(parsed: unknown, manifest: CaptureManifest): CaptureSummary {
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  return {
    title: stringValue(record.title) || manifest.title || "Meeting Summary",
    tldr: stringValue(record.tldr),
    summary: stringValue(record.summary),
    actionItems: normalizeActionItems(record.actionItems),
    notableQuotes: normalizeQuotes(record.notableQuotes),
    tags: normalizeTags(record.tags),
    raw: parsed,
  };
}

function buildSummaryPrompt(input: {
  manifest: CaptureManifest;
  transcriptMarkdown: string;
  profile: ReturnType<typeof readRecordingSummaryProfile>;
}) {
  const manifest = input.manifest;
  return [
    "You are a meeting synthesis assistant for Prism.",
    "Return valid JSON only. Do not include markdown fences or extra commentary.",
    "Summarize the meeting transcript and extract action items, notable quotes, and tags.",
    "The transcript may interleave spoken voice segments, browser-captured audio, and platform chat messages.",
    "Do not invent details not present in the transcript.",
    "",
    `Workspace summary profile source: ${input.profile.source}`,
    input.profile.content || "No additional workspace summary profile is configured.",
    "",
    "Use exactly this JSON schema:",
    "{",
    '  "title": "descriptive title",',
    '  "tldr": "short summary",',
    '  "summary": "detailed summary",',
    '  "actionItems": [{"name":"string","description":"string","assignedTo":"string or null","dueDate":"YYYY-MM-DD or null","params":{}}],',
    '  "notableQuotes": [{"author":"string","quote":"string","paraphrase":"string"}],',
    '  "tags": ["tag-1","tag-2","tag-3"]',
    "}",
    "",
    "Meeting metadata:",
    `- Capture ID: ${manifest.id}`,
    `- Title: ${manifest.title || "Browser capture"}`,
    `- Source: ${manifest.sourcePlatform || manifest.source}`,
    `- Started: ${new Date(manifest.startedAt).toISOString()}`,
    `- Ended: ${manifest.finalizedAt ? new Date(manifest.finalizedAt).toISOString() : "not finalized"}`,
    manifest.notes ? `- Operator notes: ${manifest.notes}` : "- Operator notes: none",
    "",
    "Transcript:",
    input.transcriptMarkdown.slice(0, 120_000),
  ].join("\n");
}

function renderSummaryMarkdown(manifest: CaptureManifest, summary: CaptureSummary) {
  const actionLines = summary.actionItems.length > 0
    ? summary.actionItems
        .map((item) => `- ${item.name}: ${item.description}${item.assignedTo ? ` (owner: ${item.assignedTo})` : ""}${item.dueDate ? ` (due: ${item.dueDate})` : ""}`)
        .join("\n")
    : "- None captured.";
  const quoteLines = summary.notableQuotes.length > 0
    ? summary.notableQuotes
        .map((item) => `- ${item.author}: "${item.quote}"${item.paraphrase ? `\n  - ${item.paraphrase}` : ""}`)
        .join("\n")
    : "- None captured.";

  return [
    `# ${summary.title || manifest.title || "Meeting Summary"}`,
    "",
    `- Capture: ${manifest.id}`,
    `- Source: ${manifest.sourcePlatform || manifest.source}`,
    `- Started: ${new Date(manifest.startedAt).toISOString()}`,
    `- Ended: ${manifest.finalizedAt ? new Date(manifest.finalizedAt).toISOString() : "not finalized"}`,
    summary.tags.length > 0 ? `- Tags: ${summary.tags.join(", ")}` : "- Tags: none",
    "",
    "## TL;DR",
    "",
    summary.tldr || "No short summary generated.",
    "",
    "## Summary",
    "",
    summary.summary || "No detailed summary generated.",
    "",
    "## Action Items",
    "",
    actionLines,
    "",
    "## Notable Quotes",
    "",
    quoteLines,
    "",
  ].join("\n");
}

export async function summarizeCaptureSession(captureId: string) {
  const manifest = await getCaptureManifest(captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  if (manifest.transcript?.status !== "completed") {
    throw new Error("CAPTURE_TRANSCRIPT_NOT_READY");
  }

  await markCaptureSummaryPending(captureId);
  try {
    const transcript = await readCaptureTranscriptFiles(captureId);
    const profile = readRecordingSummaryProfile();
    const prompt = buildSummaryPrompt({
      manifest: transcript.manifest,
      transcriptMarkdown: transcript.markdown,
      profile,
    });
    const parsed = safeJsonParse(await codexRuntimeRequest({
      prompt,
      captureId,
      metadata: {
        purpose: "capture_meeting_summary",
        source: transcript.manifest.source,
        captureId,
      },
    }));
    const summary = normalizeSummary(parsed, transcript.manifest);
    const summaryMarkdown = renderSummaryMarkdown(transcript.manifest, summary);
    let completed = await writeCaptureSummaryFiles({
      captureId,
      jsonContent: JSON.stringify(summary, null, 2),
      markdownContent: summaryMarkdown,
    });
    const memory = await promoteMeetingSummaryToMemory({
      content: summaryMarkdown,
      title: summary.title,
      tldr: summary.tldr,
      source: "browser-capture",
      sourceId: transcript.manifest.id,
      sourceSystem: "browser-capture",
      timestamp: transcript.manifest.finalizedAt ?? transcript.manifest.startedAt,
      author: "Prism Browser Capture",
      metadata: {
        capture_id: transcript.manifest.id,
        request_id: transcript.manifest.requestId,
        started_at: transcript.manifest.startedAt,
        ended_at: transcript.manifest.finalizedAt,
        source_platform: transcript.manifest.sourcePlatform,
        action_items: summary.actionItems,
        tags: summary.tags,
      },
    }).catch((error): MeetingMemoryPromotionResult => ({
      ok: false,
      memoryPath: null,
      artifactUrl: null,
      skippedReason: error instanceof Error ? error.message : "PRISM_MEMORY_PROMOTION_FAILED",
    }));
    if (memory.memoryPath || memory.artifactUrl) {
      completed = await updateCaptureSummaryMemory({
        captureId,
        memoryPath: memory.memoryPath,
        memoryArtifactUrl: memory.artifactUrl,
      });
    }
    return {
      manifest: completed,
      summary: {
        ...summary,
        memory,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAPTURE_SUMMARY_FAILED";
    await markCaptureSummaryFailed({ captureId, error: message }).catch(() => undefined);
    throw error;
  }
}
