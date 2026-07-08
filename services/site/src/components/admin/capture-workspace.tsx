"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, Mic, MonitorUp, Radio, Square } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { CaptureChunkRecord, CaptureManifest } from "@/lib/app-core";

type CapturePayload = {
  ok?: boolean;
  error?: string;
  capture?: CaptureManifest;
  manifest?: CaptureManifest;
  chunk?: CaptureChunkRecord;
};

type ChunkUploadState = {
  index: number;
  status: "uploading" | "uploaded" | "failed";
  sizeBytes: number;
  durationMs: number | null;
  error: string | null;
};

const mimeCandidates = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/webm",
];

function preferredMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function extensionForMimeType(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("mp4")) return "m4a";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  return "webm";
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDuration(ms: number | null) {
  if (!ms || !Number.isFinite(ms)) return "unknown";
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

async function parseJsonResponse(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as CapturePayload;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

export function CaptureWorkspace() {
  const [isBrowserReady, setIsBrowserReady] = useState(false);
  const [title, setTitle] = useState("");
  const [sourcePlatform, setSourcePlatform] = useState("");
  const [notes, setNotes] = useState("");
  const [includeTabAudio, setIncludeTabAudio] = useState(true);
  const [includeMic, setIncludeMic] = useState(true);
  const [chunkSeconds, setChunkSeconds] = useState(300);
  const [audioBitsPerSecond, setAudioBitsPerSecond] = useState(64000);
  const [capture, setCapture] = useState<CaptureManifest | null>(null);
  const [chunks, setChunks] = useState<ChunkUploadState[]>([]);
  const [status, setStatus] = useState<"idle" | "starting" | "recording" | "stopping" | "finalized">("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const uploadPromisesRef = useRef<Array<Promise<void>>>([]);
  const chunkIndexRef = useRef(0);
  const lastChunkAtRef = useRef<number | null>(null);
  const captureIdRef = useRef<string | null>(null);

  const mimeType = useMemo(() => (isBrowserReady ? preferredMimeType() : ""), [isBrowserReady]);
  const isRecording = status === "recording" || status === "starting" || status === "stopping";
  const uploadedCount = chunks.filter((chunk) => chunk.status === "uploaded").length;
  const failedCount = chunks.filter((chunk) => chunk.status === "failed").length;
  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.sizeBytes, 0);
  const uploadProgress = chunks.length ? Math.round((uploadedCount / chunks.length) * 100) : 0;

  useEffect(() => {
    setIsBrowserReady(
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices) &&
      typeof MediaRecorder !== "undefined",
    );
  }, []);

  useEffect(() => {
    if (status !== "recording" || !startedAt) return;
    const intervalId = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [startedAt, status]);

  function stopStreams() {
    for (const stream of streamsRef.current) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
    streamsRef.current = [];
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  }

  function upsertChunkState(next: ChunkUploadState) {
    setChunks((current) => {
      const without = current.filter((chunk) => chunk.index !== next.index);
      return [...without, next].sort((left, right) => left.index - right.index);
    });
  }

  async function uploadChunk(input: {
    blob: Blob;
    index: number;
    startedAt: Date;
    endedAt: Date;
    durationMs: number | null;
  }) {
    const captureId = captureIdRef.current;
    if (!captureId || input.blob.size <= 0) return;

    upsertChunkState({
      index: input.index,
      status: "uploading",
      sizeBytes: input.blob.size,
      durationMs: input.durationMs,
      error: null,
    });

    const formData = new FormData();
    const uploadMimeType = input.blob.type || mimeType || "application/octet-stream";
    const extension = extensionForMimeType(uploadMimeType);
    formData.set("chunk", input.blob, `chunk-${String(input.index).padStart(6, "0")}.${extension}`);
    formData.set("index", String(input.index));
    formData.set("mimeType", uploadMimeType);
    formData.set("startedAt", input.startedAt.toISOString());
    formData.set("endedAt", input.endedAt.toISOString());
    if (input.durationMs !== null) {
      formData.set("durationMs", String(input.durationMs));
    }

    try {
      const response = await fetch(`/admin/captures/${captureId}/chunks`, {
        method: "POST",
        body: formData,
      });
      const payload = await parseJsonResponse(response);
      if (payload.manifest) {
        setCapture(payload.manifest);
      }
      upsertChunkState({
        index: input.index,
        status: "uploaded",
        sizeBytes: input.blob.size,
        durationMs: input.durationMs,
        error: null,
      });
    } catch (uploadError) {
      upsertChunkState({
        index: input.index,
        status: "failed",
        sizeBytes: input.blob.size,
        durationMs: input.durationMs,
        error: uploadError instanceof Error ? uploadError.message : "Upload failed",
      });
    }
  }

  async function startCapture() {
    setError(null);
    setChunks([]);
    setCapture(null);
    setElapsedMs(0);
    setStatus("starting");

    try {
      if (!isBrowserReady) {
        throw new Error("Browser recording APIs are unavailable.");
      }
      if (!includeTabAudio && !includeMic) {
        throw new Error("Select at least one audio source.");
      }

      const sourceStreams: MediaStream[] = [];
      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      audioContextRef.current = audioContext;

      if (includeTabAudio) {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        sourceStreams.push(displayStream);
        for (const track of displayStream.getAudioTracks()) {
          const source = audioContext.createMediaStreamSource(new MediaStream([track]));
          source.connect(destination);
        }
      }

      if (includeMic) {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        sourceStreams.push(micStream);
        for (const track of micStream.getAudioTracks()) {
          const source = audioContext.createMediaStreamSource(new MediaStream([track]));
          source.connect(destination);
        }
      }

      if (!destination.stream.getAudioTracks().length) {
        stopStreams();
        throw new Error("No audio track was captured.");
      }

      streamsRef.current = sourceStreams;
      const createResponse = await fetch("/admin/captures", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          sourcePlatform,
          notes,
          mimeType,
          audioBitsPerSecond,
          chunkSeconds,
        }),
      });
      const createPayload = await parseJsonResponse(createResponse);
      if (!createPayload.capture) {
        throw new Error("Capture session was not created.");
      }

      const captureId = createPayload.capture.id;
      captureIdRef.current = captureId;
      setCapture(createPayload.capture);
      chunkIndexRef.current = 0;
      uploadPromisesRef.current = [];
      const now = Date.now();
      lastChunkAtRef.current = now;
      setStartedAt(now);

      const recorder = new MediaRecorder(destination.stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond,
      });
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size <= 0) return;
        const endedAtMs = Date.now();
        const startedAtMs = lastChunkAtRef.current ?? endedAtMs;
        lastChunkAtRef.current = endedAtMs;
        const index = chunkIndexRef.current;
        chunkIndexRef.current += 1;
        const uploadPromise = uploadChunk({
          blob: event.data,
          index,
          startedAt: new Date(startedAtMs),
          endedAt: new Date(endedAtMs),
          durationMs: endedAtMs > startedAtMs ? endedAtMs - startedAtMs : null,
        });
        uploadPromisesRef.current.push(uploadPromise);
      };

      recorder.onerror = () => {
        setError("Recorder error. Stop and start a new capture.");
      };

      recorder.onstop = () => {
        stopStreams();
        void finalizeCapture();
      };

      for (const stream of sourceStreams) {
        for (const track of stream.getTracks()) {
          track.addEventListener("ended", () => {
            if (recorderRef.current?.state === "recording") {
              setError("A capture source ended.");
              stopCapture();
            }
          }, { once: true });
        }
      }

      recorder.start(Math.max(5, chunkSeconds) * 1000);
      setStatus("recording");
    } catch (startError) {
      stopStreams();
      setStatus("idle");
      setError(startError instanceof Error ? startError.message : "Could not start capture.");
    }
  }

  function stopCapture() {
    setError(null);
    setStatus("stopping");
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      void finalizeCapture();
      return;
    }
    try {
      recorder.requestData();
    } catch {
      // Some browsers throw when requestData races with stop; stop still flushes.
    }
    recorder.stop();
  }

  async function finalizeCapture() {
    const captureId = captureIdRef.current;
    if (!captureId) {
      setStatus("idle");
      return;
    }
    await Promise.allSettled(uploadPromisesRef.current);
    try {
      const response = await fetch(`/admin/captures/${captureId}/finalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const payload = await parseJsonResponse(response);
      if (payload.capture) {
        setCapture(payload.capture);
      }
      setStatus("finalized");
    } catch (finalizeError) {
      setStatus("idle");
      setError(finalizeError instanceof Error ? finalizeError.message : "Could not finalize capture.");
    }
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4 md:px-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Capture</h1>
          <p className="text-sm text-muted-foreground">
            Record browser audio and microphone audio into a Prism capture session.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status === "recording" ? (
            <Badge variant="destructive" className="gap-2">
              <Radio className="h-3.5 w-3.5" />
              {formatDuration(elapsedMs)}
            </Badge>
          ) : capture ? (
            <Badge variant={capture.status === "finalized" ? "secondary" : "outline"}>
              {capture.status}
            </Badge>
          ) : null}
        </div>
      </div>

      <section className="grid gap-5 px-5 md:grid-cols-[minmax(0,1fr)_360px] md:px-6">
        <div className="grid gap-5">
          {error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Capture error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {!isBrowserReady ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Recorder unavailable</AlertTitle>
              <AlertDescription>
                This browser does not expose the required recording APIs.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="border border-border/70 bg-background p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="capture-title">Title</Label>
                <Input
                  id="capture-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={isRecording}
                  placeholder="Weekly sync"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="capture-platform">Source</Label>
                <Input
                  id="capture-platform"
                  value={sourcePlatform}
                  onChange={(event) => setSourcePlatform(event.target.value)}
                  disabled={isRecording}
                  placeholder="Meet, Zoom, Discord, Teams"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="capture-chunk-seconds">Chunk seconds</Label>
                <Input
                  id="capture-chunk-seconds"
                  type="number"
                  min={5}
                  max={600}
                  value={chunkSeconds}
                  onChange={(event) => setChunkSeconds(Number(event.target.value))}
                  disabled={isRecording}
                />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="capture-notes">Notes</Label>
                <Textarea
                  id="capture-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  disabled={status === "stopping"}
                  placeholder="Optional operator notes"
                  className="min-h-[92px]"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-3 border border-border/70 bg-background p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <MonitorUp className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Tab or screen audio</p>
                  <p className="text-xs text-muted-foreground">
                    Browser permission picker decides the source.
                  </p>
                </div>
              </div>
              <Switch checked={includeTabAudio} onCheckedChange={setIncludeTabAudio} disabled={isRecording} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Mic className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Microphone</p>
                  <p className="text-xs text-muted-foreground">Uses browser microphone capture.</p>
                </div>
              </div>
              <Switch checked={includeMic} onCheckedChange={setIncludeMic} disabled={isRecording} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {status === "idle" || status === "finalized" ? (
              <Button type="button" onClick={startCapture} disabled={!isBrowserReady}>
                <Radio className="h-4 w-4" />
                Start Capture
              </Button>
            ) : (
              <Button type="button" variant="destructive" onClick={stopCapture} disabled={status === "stopping"}>
                {status === "stopping" ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
                Stop
              </Button>
            )}
          </div>

          <div className="border border-border/70 bg-background p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Chunk uploads</p>
                <p className="text-xs text-muted-foreground">
                  {uploadedCount} uploaded / {chunks.length} emitted
                </p>
              </div>
              <Badge variant={failedCount ? "destructive" : "outline"}>
                {formatBytes(totalBytes)}
              </Badge>
            </div>
            <Progress value={uploadProgress} className="mt-3" />
            <div className="mt-4 grid gap-2">
              {chunks.length ? (
                chunks.map((chunk) => (
                  <div
                    key={chunk.index}
                    className="flex flex-wrap items-center justify-between gap-2 border border-border/60 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      {chunk.status === "uploaded" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : chunk.status === "failed" ? (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      ) : (
                        <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                      <span>Chunk {chunk.index + 1}</span>
                      <span className="text-muted-foreground">{formatDuration(chunk.durationMs)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {chunk.error ?? formatBytes(chunk.sizeBytes)}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No chunks uploaded yet.</p>
              )}
            </div>
          </div>
        </div>

        <aside className="grid content-start gap-4">
          <div className="border border-border/70 bg-background p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Format</p>
            <p className="mt-2 break-all text-sm font-medium">{mimeType || "browser default"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{audioBitsPerSecond} bps target</p>
          </div>

          <div className="border border-border/70 bg-background p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Session</p>
            {capture ? (
              <div className="mt-3 grid gap-2 text-sm">
                <div>
                  <p className="text-muted-foreground">ID</p>
                  <p className="break-all font-mono text-xs">{capture.id}</p>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Status</span>
                  <span>{capture.status}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Manifest chunks</span>
                  <span>{capture.chunks.length}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Started</span>
                  <span>{new Date(capture.startedAt).toLocaleTimeString()}</span>
                </div>
                {capture.finalizedAt ? (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Finalized</span>
                    <span>{new Date(capture.finalizedAt).toLocaleTimeString()}</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No active capture.</p>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}
