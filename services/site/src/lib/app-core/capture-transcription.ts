import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getCaptureManifest,
  markCaptureTranscriptFailed,
  markCaptureTranscriptPending,
  resolveCaptureStoragePath,
  writeCaptureTranscriptFiles,
  type CaptureChunkRecord,
} from "./capture-storage";

const minTranscribableAudioBytes = 1024;

type TranscriptionTimestampSegment = {
  text?: unknown;
  start?: unknown;
  end?: unknown;
};

type TranscriptionResponse = {
  text?: unknown;
  duration?: unknown;
  timestamps?: {
    segment?: TranscriptionTimestampSegment[];
  };
};

type CaptureTranscriptSegment = {
  text: string;
  start: number;
  end: number;
  chunkIndex: number;
  source: "browser-capture";
};

type CaptureTranscriptChunk = {
  index: number;
  filename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  startedAt: string | null;
  endedAt: string | null;
  status: "transcribed" | "skipped";
  text: string;
  segments: CaptureTranscriptSegment[];
  reason: string | null;
};

function transcriptionApiKey() {
  return (
    process.env.VOICE_TRANSCRIPTION_API_KEY?.trim()
    || process.env.VENICE_API_KEY?.trim()
    || ""
  );
}

function transcriptionApiUrl() {
  return (
    process.env.VOICE_TRANSCRIPTION_BASE_URL?.trim().replace(/\/+$/, "")
    || process.env.VENICE_TRANSCRIPTION_BASE_URL?.trim().replace(/\/+$/, "")
    || ""
  );
}

function transcriptionModel() {
  return process.env.VOICE_TRANSCRIPTION_MODEL?.trim() || process.env.VENICE_TRANSCRIPTION_MODEL?.trim() || "";
}

function maxUploadBytes() {
  const rawMb = Number.parseInt(process.env.VOICE_TRANSCRIPTION_MAX_UPLOAD_MB ?? "25", 10);
  const safeMb = Number.isFinite(rawMb) ? Math.max(1, Math.min(rawMb, 500)) : 25;
  return safeMb * 1024 * 1024;
}

function formatTimeSec(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${remainder}`;
}

function parseNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function chunkOffsetSeconds(chunk: CaptureChunkRecord, captureStartedAt: string, fallbackOffsetSeconds: number) {
  if (!chunk.startedAt) return fallbackOffsetSeconds;
  const captureStart = Date.parse(captureStartedAt);
  const chunkStart = Date.parse(chunk.startedAt);
  if (!Number.isFinite(captureStart) || !Number.isFinite(chunkStart)) return fallbackOffsetSeconds;
  return Math.max(0, (chunkStart - captureStart) / 1000);
}

function normalizeSegments(input: {
  chunk: CaptureChunkRecord;
  response: TranscriptionResponse;
  offsetSeconds: number;
}) {
  const rawSegments = Array.isArray(input.response.timestamps?.segment)
    ? input.response.timestamps?.segment ?? []
    : [];
  const segments = rawSegments
    .map((segment) => ({
      text: String(segment.text ?? "").trim(),
      start: parseNumber(segment.start) + input.offsetSeconds,
      end: parseNumber(segment.end) + input.offsetSeconds,
      chunkIndex: input.chunk.index,
      source: "browser-capture" as const,
    }))
    .filter((segment) => segment.text);

  if (segments.length > 0) {
    return segments;
  }

  const fallbackText = String(input.response.text ?? "").trim();
  if (!fallbackText) {
    return [];
  }

  const durationSeconds = input.chunk.durationMs
    ? Math.max(1, Math.round(input.chunk.durationMs / 1000))
    : Math.max(1, parseNumber(input.response.duration, 1));
  return [
    {
      text: fallbackText,
      start: input.offsetSeconds,
      end: input.offsetSeconds + durationSeconds,
      chunkIndex: input.chunk.index,
      source: "browser-capture" as const,
    },
  ];
}

async function transcribeChunk(chunkPath: string, chunk: CaptureChunkRecord) {
  const apiKey = transcriptionApiKey();
  const apiUrl = transcriptionApiUrl();
  if (!apiKey || !apiUrl) {
    throw new Error("CAPTURE_TRANSCRIPTION_NOT_CONFIGURED");
  }

  const fileBuffer = await fs.readFile(chunkPath);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(fileBuffer)], { type: chunk.mimeType || "audio/webm" }), path.basename(chunkPath));
  const model = transcriptionModel();
  if (model) {
    form.append("model", model);
  }
  form.append("response_format", process.env.VOICE_TRANSCRIPTION_RESPONSE_FORMAT?.trim() || "json");
  form.append("timestamps", process.env.VOICE_TRANSCRIPTION_TIMESTAMPS?.trim() || "true");
  const language = process.env.VOICE_TRANSCRIPTION_LANGUAGE?.trim();
  if (language) {
    form.append("language", language);
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`CAPTURE_TRANSCRIPTION_FAILED:${response.status}:${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()) as TranscriptionResponse;
}

function buildMarkdown(input: {
  title: string;
  captureId: string;
  startedAt: string;
  finalizedAt: string | null;
  generatedAt: string;
  chunks: CaptureTranscriptChunk[];
  segments: CaptureTranscriptSegment[];
}) {
  const skipped = input.chunks.filter((chunk) => chunk.status === "skipped");
  return [
    `# ${input.title || "Browser Capture Transcript"}`,
    "",
    `- Capture: \`${input.captureId}\``,
    `- Started: ${input.startedAt}`,
    input.finalizedAt ? `- Finalized: ${input.finalizedAt}` : null,
    `- Generated: ${input.generatedAt}`,
    `- Chunks: ${input.chunks.length}`,
    "",
    "## Transcript",
    "",
    input.segments.length
      ? input.segments.map((segment) => `[${formatTimeSec(segment.start)}] ${segment.text}`).join("\n")
      : "_No transcript text returned._",
    "",
    skipped.length
      ? [
          "## Skipped Chunks",
          "",
          ...skipped.map((chunk) => `- Chunk ${chunk.index + 1} (${chunk.filename}): ${chunk.reason ?? "skipped"}`),
          "",
        ].join("\n")
      : null,
  ].filter((line): line is string => typeof line === "string").join("\n");
}

export async function transcribeCaptureSession(captureId: string) {
  const manifest = await getCaptureManifest(captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  if (manifest.status !== "finalized") {
    throw new Error("CAPTURE_NOT_FINALIZED");
  }
  if (manifest.chunks.length === 0) {
    throw new Error("CAPTURE_HAS_NO_CHUNKS");
  }
  if (!transcriptionApiKey() || !transcriptionApiUrl()) {
    throw new Error("CAPTURE_TRANSCRIPTION_NOT_CONFIGURED");
  }

  await markCaptureTranscriptPending(captureId);
  const generatedAt = new Date().toISOString();
  const chunks: CaptureTranscriptChunk[] = [];
  const allSegments: CaptureTranscriptSegment[] = [];
  let fallbackOffsetSeconds = 0;

  try {
    for (const chunk of manifest.chunks) {
      const resolved = resolveCaptureStoragePath(chunk.storagePath);
      const stat = await fs.stat(resolved).catch(() => null);
      if (!stat || stat.size < minTranscribableAudioBytes) {
        chunks.push({
          index: chunk.index,
          filename: chunk.filename,
          storagePath: chunk.storagePath,
          mimeType: chunk.mimeType,
          sizeBytes: stat?.size ?? 0,
          durationMs: chunk.durationMs,
          startedAt: chunk.startedAt,
          endedAt: chunk.endedAt,
          status: "skipped",
          text: "",
          segments: [],
          reason: stat ? `audio chunk too small (${stat.size} bytes)` : "audio chunk missing",
        });
        continue;
      }
      if (stat.size > maxUploadBytes()) {
        chunks.push({
          index: chunk.index,
          filename: chunk.filename,
          storagePath: chunk.storagePath,
          mimeType: chunk.mimeType,
          sizeBytes: stat.size,
          durationMs: chunk.durationMs,
          startedAt: chunk.startedAt,
          endedAt: chunk.endedAt,
          status: "skipped",
          text: "",
          segments: [],
          reason: `audio chunk exceeds upload limit (${stat.size} bytes)`,
        });
        continue;
      }

      const offsetSeconds = chunkOffsetSeconds(chunk, manifest.startedAt, fallbackOffsetSeconds);
      const response = await transcribeChunk(resolved, chunk);
      const segments = normalizeSegments({ chunk, response, offsetSeconds });
      const text = segments.map((segment) => segment.text).join(" ").trim();
      allSegments.push(...segments);
      chunks.push({
        index: chunk.index,
        filename: chunk.filename,
        storagePath: chunk.storagePath,
        mimeType: chunk.mimeType,
        sizeBytes: stat.size,
        durationMs: chunk.durationMs,
        startedAt: chunk.startedAt,
        endedAt: chunk.endedAt,
        status: "transcribed",
        text,
        segments,
        reason: null,
      });
      fallbackOffsetSeconds += chunk.durationMs ? chunk.durationMs / 1000 : Math.max(0, ...segments.map((segment) => segment.end));
    }

    allSegments.sort((left, right) => left.start - right.start);
    const payload = {
      captureId: manifest.id,
      title: manifest.title,
      source: manifest.source,
      startedAt: manifest.startedAt,
      finalizedAt: manifest.finalizedAt,
      generatedAt,
      chunks,
      segments: allSegments,
      transcript: allSegments.map((segment) => `[${formatTimeSec(segment.start)}] ${segment.text}`).join("\n"),
    };
    const completed = await writeCaptureTranscriptFiles({
      captureId,
      jsonContent: JSON.stringify(payload, null, 2),
      markdownContent: buildMarkdown({
        title: manifest.title,
        captureId: manifest.id,
        startedAt: manifest.startedAt,
        finalizedAt: manifest.finalizedAt,
        generatedAt,
        chunks,
        segments: allSegments,
      }),
      chunksTranscribed: chunks.filter((chunk) => chunk.status === "transcribed").length,
      chunksSkipped: chunks.filter((chunk) => chunk.status === "skipped").length,
    });

    return { manifest: completed, transcript: payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAPTURE_TRANSCRIPTION_FAILED";
    await markCaptureTranscriptFailed({ captureId, error: message }).catch(() => undefined);
    throw error;
  }
}
