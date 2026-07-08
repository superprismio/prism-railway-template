import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";

const captureRootName = "captures";

export type CaptureChunkRecord = {
  index: number;
  filename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  uploadedAt: string;
};

export type CaptureTranscriptRecord = {
  status: "pending" | "completed" | "failed";
  transcriptJsonPath: string | null;
  transcriptMarkdownPath: string | null;
  generatedAt: string | null;
  chunksTranscribed: number;
  chunksSkipped: number;
  error: string | null;
};

export type CaptureManifest = {
  id: string;
  title: string;
  status: "recording" | "finalized";
  source: "browser-capture";
  audioOnly: boolean;
  requestId: string | null;
  sourcePlatform: string | null;
  notes: string | null;
  mimeType: string | null;
  audioBitsPerSecond: number | null;
  chunkSeconds: number | null;
  startedAt: string;
  finalizedAt: string | null;
  chunks: CaptureChunkRecord[];
  transcript: CaptureTranscriptRecord | null;
  updatedAt: string;
};

function sanitizeFilename(value: string) {
  const candidate = value
    .trim()
    .replace(/[/\\]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return candidate || "capture";
}

function sanitizeChunkExtension(mimeType: string) {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("mp4")) return "m4a";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  return "webm";
}

function normalizePositiveInteger(value: number | null | undefined, max: number) {
  if (!Number.isFinite(value)) return null;
  const normalized = Math.trunc(value as number);
  if (normalized <= 0) return null;
  return Math.min(normalized, max);
}

export function captureStorageRoot() {
  return path.resolve(loadConfig().dataRoot, captureRootName);
}

export function captureSessionStoragePath(captureId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(captureId)) {
    throw new Error("INVALID_CAPTURE_ID");
  }
  return path.join("sessions", captureId);
}

export function resolveCaptureStoragePath(storagePath: string) {
  const root = captureStorageRoot();
  const resolved = path.resolve(root, storagePath);
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("CAPTURE_PATH_OUTSIDE_ROOT");
  }

  return resolved;
}

function manifestStoragePath(captureId: string) {
  return path.join(captureSessionStoragePath(captureId), "capture-manifest.json");
}

export function captureTranscriptStoragePaths(captureId: string) {
  return {
    json: path.join(captureSessionStoragePath(captureId), "transcripts", "transcript.json"),
    markdown: path.join(captureSessionStoragePath(captureId), "transcripts", "transcript.md"),
  };
}

export async function getCaptureManifest(captureId: string) {
  try {
    const content = await fs.readFile(resolveCaptureStoragePath(manifestStoragePath(captureId)), "utf8");
    const parsed = JSON.parse(content) as CaptureManifest;
    return parsed?.id === captureId ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeCaptureManifest(manifest: CaptureManifest) {
  const resolved = resolveCaptureStoragePath(manifestStoragePath(manifest.id));
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function createCaptureSession(input: {
  title?: string | null;
  requestId?: string | null;
  sourcePlatform?: string | null;
  notes?: string | null;
  mimeType?: string | null;
  audioBitsPerSecond?: number | null;
  chunkSeconds?: number | null;
}) {
  const now = new Date().toISOString();
  const id = randomUUID();
  const manifest: CaptureManifest = {
    id,
    title: input.title?.trim() || `Browser capture ${now}`,
    status: "recording",
    source: "browser-capture",
    audioOnly: true,
    requestId: input.requestId?.trim() || null,
    sourcePlatform: input.sourcePlatform?.trim() || null,
    notes: input.notes?.trim() || null,
    mimeType: input.mimeType?.trim() || null,
    audioBitsPerSecond: normalizePositiveInteger(input.audioBitsPerSecond, 320000),
    chunkSeconds: normalizePositiveInteger(input.chunkSeconds, 600),
    startedAt: now,
    finalizedAt: null,
    chunks: [],
    transcript: null,
    updatedAt: now,
  };
  await writeCaptureManifest(manifest);
  return manifest;
}

export async function writeCaptureChunk(input: {
  captureId: string;
  index: number;
  content: Buffer;
  mimeType: string;
  startedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
}) {
  const manifest = await getCaptureManifest(input.captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  if (manifest.status !== "recording") {
    throw new Error("CAPTURE_NOT_RECORDING");
  }

  const extension = sanitizeChunkExtension(input.mimeType);
  const filename = `${String(input.index).padStart(6, "0")}-${sanitizeFilename(manifest.title)}.${extension}`;
  const storagePath = path.join(captureSessionStoragePath(input.captureId), "chunks", filename);
  const resolved = resolveCaptureStoragePath(storagePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, input.content);

  const now = new Date().toISOString();
  const chunk: CaptureChunkRecord = {
    index: input.index,
    filename,
    storagePath,
    mimeType: input.mimeType,
    sizeBytes: input.content.byteLength,
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
    durationMs: Number.isFinite(input.durationMs) ? Math.trunc(input.durationMs as number) : null,
    uploadedAt: now,
  };
  const chunks = manifest.chunks.filter((existing) => existing.index !== input.index);
  chunks.push(chunk);
  chunks.sort((left, right) => left.index - right.index);
  const updated = {
    ...manifest,
    mimeType: manifest.mimeType ?? input.mimeType,
    chunks,
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return { manifest: updated, chunk };
}

export async function finalizeCaptureSession(input: {
  captureId: string;
  notes?: string | null;
  requestId?: string | null;
}) {
  const manifest = await getCaptureManifest(input.captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  const now = new Date().toISOString();
  const updated: CaptureManifest = {
    ...manifest,
    status: "finalized",
    notes: input.notes?.trim() || manifest.notes,
    requestId: input.requestId?.trim() || manifest.requestId,
    finalizedAt: manifest.finalizedAt ?? now,
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return updated;
}

export async function markCaptureTranscriptPending(captureId: string) {
  const manifest = await getCaptureManifest(captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  const now = new Date().toISOString();
  const updated: CaptureManifest = {
    ...manifest,
    transcript: {
      status: "pending",
      transcriptJsonPath: null,
      transcriptMarkdownPath: null,
      generatedAt: null,
      chunksTranscribed: 0,
      chunksSkipped: 0,
      error: null,
    },
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return updated;
}

export async function writeCaptureTranscriptFiles(input: {
  captureId: string;
  jsonContent: string;
  markdownContent: string;
  chunksTranscribed: number;
  chunksSkipped: number;
}) {
  const manifest = await getCaptureManifest(input.captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }

  const paths = captureTranscriptStoragePaths(input.captureId);
  const resolvedJson = resolveCaptureStoragePath(paths.json);
  const resolvedMarkdown = resolveCaptureStoragePath(paths.markdown);
  await fs.mkdir(path.dirname(resolvedJson), { recursive: true });
  await fs.writeFile(resolvedJson, input.jsonContent.endsWith("\n") ? input.jsonContent : `${input.jsonContent}\n`, "utf8");
  await fs.writeFile(
    resolvedMarkdown,
    input.markdownContent.endsWith("\n") ? input.markdownContent : `${input.markdownContent}\n`,
    "utf8",
  );

  const now = new Date().toISOString();
  const updated: CaptureManifest = {
    ...manifest,
    transcript: {
      status: "completed",
      transcriptJsonPath: paths.json,
      transcriptMarkdownPath: paths.markdown,
      generatedAt: now,
      chunksTranscribed: Math.max(0, Math.trunc(input.chunksTranscribed)),
      chunksSkipped: Math.max(0, Math.trunc(input.chunksSkipped)),
      error: null,
    },
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return updated;
}

export async function markCaptureTranscriptFailed(input: {
  captureId: string;
  error: string;
}) {
  const manifest = await getCaptureManifest(input.captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  const now = new Date().toISOString();
  const updated: CaptureManifest = {
    ...manifest,
    transcript: {
      status: "failed",
      transcriptJsonPath: manifest.transcript?.transcriptJsonPath ?? null,
      transcriptMarkdownPath: manifest.transcript?.transcriptMarkdownPath ?? null,
      generatedAt: manifest.transcript?.generatedAt ?? null,
      chunksTranscribed: manifest.transcript?.chunksTranscribed ?? 0,
      chunksSkipped: manifest.transcript?.chunksSkipped ?? 0,
      error: input.error,
    },
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return updated;
}
