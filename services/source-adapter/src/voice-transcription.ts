import fs from "node:fs/promises";
import path from "node:path";

type VoiceTranscriptionResponse = {
  text?: string;
  duration?: number;
  timestamps?: { segment?: Array<{ text?: string; start?: number; end?: number }> };
};

type TranscriptionOptions = {
  url: string;
  apiKey: string;
  filePath: string;
  model?: string;
  responseFormat?: string;
  timestamps?: string;
  language?: string;
};

type Dependencies = {
  readFile?: (filePath: string) => Promise<Buffer>;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  timeoutMs?: number;
};

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const DEFAULT_TIMEOUT_MS = 120_000;

export function retryAfterDelay(value: string | null, now: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  let ms: number;
  if (/^\d+$/.test(trimmed)) {
    ms = Number(trimmed) * 1000;
  } else {
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return null;
    const date = Date.parse(trimmed);
    if (!Number.isFinite(date)) return null;
    ms = date - now;
  }
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.min(60_000, ms));
}

function isTransportError(error: unknown): boolean {
  // fetch throws TypeError on network failures; AbortError/TimeoutError cover its deadline.
  return error instanceof TypeError ||
    (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name));
}

export async function transcribeVoiceChunk(
  options: TranscriptionOptions,
  deps: Dependencies = {},
): Promise<VoiceTranscriptionResponse> {
  const readFile = deps.readFile ?? fs.readFile;
  const fetcher = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = deps.random ?? Math.random;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fileBuffer = await readFile(options.filePath);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(fileBuffer)], { type: "audio/flac" }), path.basename(options.filePath));
    if (options.model) form.append("model", options.model);
    form.append("response_format", options.responseFormat || "json");
    form.append("timestamps", options.timestamps || "true");
    if (options.language) form.append("language", options.language);

    let response: Response;
    try {
      response = await fetcher(options.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
      // Reading the body is part of the request deadline too.
      if (!response.ok) {
        const errorText = (await response.text()).slice(0, 300);
        if (attempt < MAX_ATTEMPTS && RETRYABLE_STATUSES.has(response.status)) {
          const retryAfter = retryAfterDelay(response.headers.get("retry-after"), now());
          const backoff = Math.min(60_000, 2_000 * 2 ** (attempt - 1) + Math.floor(random() * 1_000));
          const delay = retryAfter ?? backoff;
          console.warn(`[discord-adapter] voice transcription retry file=${path.basename(options.filePath)} attempt=${attempt}/${MAX_ATTEMPTS} status=${response.status} delayMs=${delay}`);
          await sleep(delay);
          continue;
        }
        throw new Error(`Voice transcription failed: ${response.status} ${errorText}`);
      }
      // Bad JSON is a provider/protocol error, not a transient transport failure.
      return (await response.json()) as VoiceTranscriptionResponse;
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isTransportError(error)) throw error;
      const backoff = Math.min(60_000, 2_000 * 2 ** (attempt - 1) + Math.floor(random() * 1_000));
      console.warn(`[discord-adapter] voice transcription retry file=${path.basename(options.filePath)} attempt=${attempt}/${MAX_ATTEMPTS} category=transport-or-timeout delayMs=${backoff}`);
      await sleep(backoff);
    }
  }
  throw new Error("Voice transcription retry loop exhausted");
}
