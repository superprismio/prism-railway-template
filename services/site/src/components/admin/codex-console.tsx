"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, Copy, Cpu, ExternalLink, LoaderCircle, Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  MemoryDocumentUploadButton,
  type UploadedMemoryArtifact,
} from "@/components/admin/memory-document-upload-button";
import { describeFetchError, readApiError } from "@/lib/client-api-errors";

type ConsoleMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type StoredConsoleMessage = {
  id: string;
  role: string;
  content: string;
};

type ConsoleSession = {
  meta?: {
    runtimeKey?: string | null;
  } | null;
};

type RuntimeProfile = {
  key: string;
  name: string;
  isDefault: boolean;
};

type ConsoleTraceEntry = {
  at?: string;
  kind?: string;
  message?: string;
};

type ConsolePollError = Error & {
  transient?: boolean;
};

const consoleSessionStorageKey = "prism-console-session-id";
const consoleActiveJobStorageKey = "prism-console-active-job-id";
const transientPollStatuses = new Set([408, 429, 502, 503, 504]);

function isTouchFirstInputEnvironment() {
  if (typeof window === "undefined") return false;
  const hasTouchPoints = navigator.maxTouchPoints > 0;
  const hasCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const hasNoHover = window.matchMedia("(hover: none)").matches;
  return hasTouchPoints && (hasCoarsePointer || hasNoHover);
}

function randomMessageId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function displayConsoleContent(role: string, content: string) {
  if (role !== "user") return content;
  const marker = "\n\nConsole question:\n";
  const markerIndex = content.lastIndexOf(marker);
  return markerIndex >= 0 ? content.slice(markerIndex + marker.length).trim() : content;
}

function scrollToLatestMessage(
  element: HTMLDivElement | null,
  behavior: ScrollBehavior = "auto",
) {
  if (!element) return;
  element.scrollTo({
    top: element.scrollHeight,
    behavior,
  });
}

function createTransientConsolePollError(message: string) {
  const error = new Error(message) as ConsolePollError;
  error.transient = true;
  return error;
}

function isTransientConsolePollError(error: unknown) {
  return (
    (error instanceof TypeError && /fetch/i.test(error.message)) ||
    (error instanceof Error && Boolean((error as ConsolePollError).transient))
  );
}

export function CodexConsole({
  isActive = true,
  sessionControlsTargetId,
}: {
  isActive?: boolean;
  sessionControlsTargetId?: string;
}) {
  const [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConsoleMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobTrace, setActiveJobTrace] = useState<ConsoleTraceEntry[]>([]);
  const [runtimeProfiles, setRuntimeProfiles] = useState<RuntimeProfile[]>([]);
  const [sessionRuntimeKey, setSessionRuntimeKey] = useState<string | null>(null);
  const [pollNotice, setPollNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [usesTouchFirstInput, setUsesTouchFirstInput] = useState(false);
  const [attachedArtifacts, setAttachedArtifacts] = useState<UploadedMemoryArtifact[]>([]);
  const [sessionControlsTarget, setSessionControlsTarget] =
    useState<HTMLElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const isPending = isSubmitting || Boolean(activeJobId);

  useEffect(() => {
    const coarsePointerQuery = window.matchMedia("(pointer: coarse)");
    const noHoverQuery = window.matchMedia("(hover: none)");
    const syncInputEnvironment = () => {
      setUsesTouchFirstInput(isTouchFirstInputEnvironment());
    };
    syncInputEnvironment();
    coarsePointerQuery.addEventListener("change", syncInputEnvironment);
    noHoverQuery.addEventListener("change", syncInputEnvironment);
    return () => {
      coarsePointerQuery.removeEventListener("change", syncInputEnvironment);
      noHoverQuery.removeEventListener("change", syncInputEnvironment);
    };
  }, []);

  const loadConsoleHistory = useCallback(async (targetSessionId: string) => {
    const response = await fetch(
      `/admin/responses?session_id=${encodeURIComponent(targetSessionId)}`,
      {
        cache: "no-store",
      },
    );
    const payload = (await response.json()) as {
      ok?: boolean;
      session?: ConsoleSession;
      messages?: StoredConsoleMessage[];
      error?: string;
    };
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "Could not load console history");
    }
    const restoredMessages = Array.isArray(payload.messages)
      ? payload.messages
          .filter(
            (message) =>
              message.role === "user" || message.role === "assistant",
          )
          .map((message) => ({
            id: message.id,
            role: message.role as "user" | "assistant",
            content: displayConsoleContent(message.role, message.content),
          }))
      : [];
    setSessionId(targetSessionId);
    setSessionRuntimeKey(payload.session?.meta?.runtimeKey ?? null);
    setMessages(restoredMessages);
  }, []);

  const loadRuntimeProfiles = useCallback(async () => {
    const response = await fetch("/admin/runtime-profiles", { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json().catch(() => null)) as {
      profiles?: RuntimeProfile[];
    } | null;
    if (Array.isArray(payload?.profiles)) {
      setRuntimeProfiles(payload.profiles);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void loadRuntimeProfiles();
  }, [isActive, loadRuntimeProfiles]);

  useEffect(() => {
    const storedSessionId = window.localStorage.getItem(
      consoleSessionStorageKey,
    );
    const storedJobId = window.localStorage.getItem(consoleActiveJobStorageKey);
    if (storedJobId) {
      setActiveJobId(storedJobId);
    }
    if (!storedSessionId) return;

    setIsLoadingHistory(true);
    loadConsoleHistory(storedSessionId)
      .catch(() => {
        window.localStorage.removeItem(consoleSessionStorageKey);
      })
      .finally(() => setIsLoadingHistory(false));
  }, [loadConsoleHistory]);

  useEffect(() => {
    scrollToLatestMessage(
      transcriptRef.current,
      messages.length > 1 ? "smooth" : "auto",
    );
  }, [isActive, isLoadingHistory, messages.length, isPending]);

  useEffect(() => {
    if (!sessionControlsTargetId) return;
    setSessionControlsTarget(document.getElementById(sessionControlsTargetId));
  }, [sessionControlsTargetId]);

  useEffect(() => {
    if (!isActive) return;
    const focusInput = () => {
      scrollToLatestMessage(transcriptRef.current);
      inputRef.current?.focus({ preventScroll: true });
    };
    const frameId = window.requestAnimationFrame(focusInput);
    const timeoutId = window.setTimeout(focusInput, 80);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [isActive, isLoadingHistory]);

  useEffect(() => {
    if (!activeJobId) return;
    let canceled = false;
    let timeoutId: number | null = null;
    let transientFailureCount = 0;

    async function pollJob() {
      try {
        const response = await fetch(
          `/admin/console/jobs/${encodeURIComponent(activeJobId!)}`,
          {
            cache: "no-store",
          },
        );
        if (!response.ok) {
          if (transientPollStatuses.has(response.status)) {
            throw createTransientConsolePollError(
              `Console job poll returned HTTP ${response.status}`,
            );
          }
          throw new Error(
            await readApiError(response, "Could not load Prism Console job"),
          );
        }
        const payload = (await response.json()) as {
          ok?: boolean;
          job?: {
            id: string;
            status: string;
            sessionId?: string | null;
            outputText?: string | null;
            errorMessage?: string | null;
            trace?: ConsoleTraceEntry[];
          };
        };
        if (canceled) {
          return;
        }
        const job = payload.job;
        if (!job) {
          throw new Error("Console job response did not include a job");
        }
        transientFailureCount = 0;
        setPollNotice(null);
        if (job.sessionId) {
          setSessionId(job.sessionId);
          window.localStorage.setItem(consoleSessionStorageKey, job.sessionId);
        }
        setActiveJobTrace(Array.isArray(job.trace) ? job.trace.slice(-8) : []);
        if (job.status === "succeeded") {
          window.localStorage.removeItem(consoleActiveJobStorageKey);
          setActiveJobId(null);
          setActiveJobTrace([]);
          setPollNotice(null);
          setError(null);
          const nextSessionId = job.sessionId ?? sessionId;
          if (nextSessionId) {
            try {
              await loadConsoleHistory(nextSessionId);
              if (canceled) {
                return;
              }
            } catch (historyError) {
              if (canceled) {
                return;
              }
              setError(
                describeFetchError(
                  historyError,
                  "Could not refresh Prism Console history",
                ),
              );
            }
          }
          return;
        }
        if (job.status === "failed" || job.status === "canceled") {
          window.localStorage.removeItem(consoleActiveJobStorageKey);
          setActiveJobId(null);
          setActiveJobTrace([]);
          setPollNotice(null);
          setError(job.errorMessage || `Console job ${job.status}`);
          return;
        }
      } catch (pollError) {
        if (canceled) {
          return;
        }
        if (isTransientConsolePollError(pollError)) {
          transientFailureCount += 1;
          const retryDelayMs = Math.min(
            15_000,
            1500 + transientFailureCount * 1000,
          );
          setPollNotice(
            transientFailureCount === 1
              ? "Console connection was interrupted. Prism may still be working; retrying status..."
              : `Console connection is still retrying status. Next check in ${Math.ceil(retryDelayMs / 1000)} seconds.`,
          );
          timeoutId = window.setTimeout(pollJob, retryDelayMs);
          return;
        }
        window.localStorage.removeItem(consoleActiveJobStorageKey);
        setActiveJobId(null);
        setPollNotice(null);
        setError(describeFetchError(pollError, "Could not run Prism Console"));
        return;
      }

      if (!canceled) {
        timeoutId = window.setTimeout(pollJob, 1500);
      }
    }

    void pollJob();
    return () => {
      canceled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [activeJobId, loadConsoleHistory, sessionId]);

  async function handleSubmit(formData: FormData) {
    const prompt = String(formData.get("prompt") ?? "").trim();
    if (!prompt) return;

    const artifactContext = attachedArtifacts.length
      ? [
          "Attached Prism Memory working documents:",
          ...attachedArtifacts.map(
            (artifact) => `- ${artifact.title} (artifact ${artifact.id}): ${artifact.viewUrl}`,
          ),
          "Use Prism Memory reader access to fetch the full artifacts when needed.",
        ].join("\n")
      : "";
    const runtimePrompt = artifactContext
      ? `${artifactContext}\n\nConsole question:\n${prompt}`
      : prompt;

    const userMessage: ConsoleMessage = {
      id: randomMessageId("user"),
      role: "user",
      content: prompt,
    };

    setDraft("");
    setError(null);
    setPollNotice(null);
    setMessages((current) => [...current, userMessage]);
    setIsSubmitting(true);

    try {
      const response = await fetch("/admin/console/jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: [{ role: "user", content: runtimePrompt }],
          session_id: sessionId,
          ...(attachedArtifacts.length ? { requested_skills: ["prism-api-reader"] } : {}),
        }),
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Could not start Prism Console job"),
        );
      }
      const payload = (await response.json().catch(() => null)) as {
        jobId?: string;
        session_id?: string;
      } | null;

      if (!payload?.jobId) {
        throw new Error("Console job endpoint did not return jobId");
      }
      setActiveJobTrace([]);
      if (payload.session_id) {
        setSessionId(payload.session_id);
        window.localStorage.setItem(
          consoleSessionStorageKey,
          payload.session_id,
        );
      }
      window.localStorage.setItem(consoleActiveJobStorageKey, payload.jobId);
      setActiveJobId(payload.jobId);
    } catch (submitError) {
      setError(describeFetchError(submitError, "Could not run Prism Console"));
    } finally {
      setIsSubmitting(false);
    }
  }

  function startNewSession() {
    window.localStorage.removeItem(consoleSessionStorageKey);
    setSessionId(null);
    setMessages([]);
    setSessionRuntimeKey(null);
    setError(null);
    setActiveJobId(null);
    setActiveJobTrace([]);
    setPollNotice(null);
    setAttachedArtifacts([]);
    window.localStorage.removeItem(consoleActiveJobStorageKey);
  }

  const visibleTrace = activeJobTrace
    .filter((entry) => entry.message?.trim())
    .slice(-5);
  const defaultRuntime = runtimeProfiles.find((profile) => profile.isDefault) ?? null;
  const activeRuntime = sessionRuntimeKey
    ? runtimeProfiles.find((profile) => profile.key === sessionRuntimeKey) ?? null
    : defaultRuntime;
  const activeRuntimeLabel = activeRuntime?.name ?? sessionRuntimeKey ?? null;

  const sessionControls = (
    <div className="flex flex-wrap items-center justify-start gap-3 sm:justify-end">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>{isPending ? "Prism is working..." : null}</span>
        {activeRuntimeLabel ? (
          <span className="flex items-center gap-1.5 text-xs text-foreground">
            <Cpu className="h-4 w-4" />
            <span>{activeRuntimeLabel}</span>
            <Badge variant="outline" className="font-normal">
              {sessionRuntimeKey ? "Session" : "Default"}
            </Badge>
          </span>
        ) : null}
        <span className="flex items-center gap-2 text-xs">
          <Bot className="h-4 w-4" />
          <span>{sessionId ? "Session live" : "New session"}</span>
        </span>
      </div>
      {sessionId ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={startNewSession}
        >
          <Plus className="h-4 w-4" />
          New session
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-248px)] min-h-0 flex-col">
      {sessionControlsTarget
        ? createPortal(sessionControls, sessionControlsTarget)
        : null}
      {!sessionControlsTarget ? (
        <div className="border-b border-border/60 px-5 py-4 md:px-6">
          {sessionControls}
        </div>
      ) : null}

      <div ref={transcriptRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 px-5 py-5 md:px-6">
          {isLoadingHistory ? (
            <div className="border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Loading console history...
            </div>
          ) : messages.length ? (
            messages.map((message) => (
              <div
                key={message.id}
                className={`px-4 py-3 text-sm leading-6 ${
                  message.role === "assistant"
                    ? "border-l-2 border-border bg-muted/20 text-foreground"
                    : "ml-auto max-w-3xl border-l-2 border-primary/60 bg-primary/12 text-foreground"
                }`}
              >
                <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.18em]">
                  <Badge
                    variant={
                      message.role === "assistant" ? "outline" : "secondary"
                    }
                  >
                    {message.role}
                  </Badge>
                </div>
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
            ))
          ) : (
            <div className="border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Start a session from the admin board. Session history is stored in
              the API and restored in this browser.
            </div>
          )}
        </div>
      </div>

      <form
        ref={formRef}
        action={handleSubmit}
        className="border-t border-border/60 px-5 py-4 md:px-6"
      >
        <div className="space-y-3">
          {attachedArtifacts.length ? (
            <div className="space-y-2 border-l-2 border-primary/50 bg-muted/20 p-3">
              {attachedArtifacts.map((artifact) => (
                <div key={artifact.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{artifact.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{artifact.filename} · {artifact.status}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button asChild type="button" variant="ghost" size="icon" title="Open artifact">
                      <a href={artifact.viewUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="Copy artifact link"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(new URL(artifact.viewUrl, window.location.origin).toString())
                          .catch(() => setError("Could not copy the artifact link. Open the artifact and copy its URL instead."));
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="Remove from chat"
                      onClick={() => setAttachedArtifacts((current) => current.filter((item) => item.id !== artifact.id))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <Textarea
            ref={inputRef}
            name="prompt"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key !== "Enter" ||
                event.shiftKey ||
                event.metaKey ||
                event.ctrlKey ||
                event.altKey ||
                usesTouchFirstInput ||
                event.nativeEvent.isComposing
              ) {
                return;
              }
              event.preventDefault();
              if (!draft.trim() || isPending) return;
              formRef.current?.requestSubmit();
            }}
            placeholder="Ask Prism about a request, review branch, preview state, or workspace context."
            className="min-h-28 rounded-none border-x-0 border-t-0 px-0 shadow-none focus-visible:ring-0"
            disabled={isPending}
            required
          />
          {activeJobId ? (
            <div className="border border-border/70 bg-muted/20 p-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                <span>Prism is working in the background.</span>
              </div>
              {visibleTrace.length ? (
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {visibleTrace.map((entry, index) => (
                    <div
                      key={`${entry.at ?? "trace"}-${index}`}
                      className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2"
                    >
                      <span className="truncate uppercase tracking-[0.14em]">
                        {entry.kind ?? "runtime"}
                      </span>
                      <span className="min-w-0 truncate">{entry.message}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  Waiting for runtime progress...
                </p>
              )}
              {pollNotice ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {pollNotice}
                </p>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <MemoryDocumentUploadButton
                disabled={isPending}
                label="Upload"
                onUploaded={(artifact) => {
                  setAttachedArtifacts((current) => current.some((item) => item.id === artifact.id) ? current : [...current, artifact]);
                }}
              />
              <p className="text-xs text-muted-foreground">
                {usesTouchFirstInput
                  ? "Return adds a new line. Use Send when ready."
                  : "Enter sends. Shift+Enter adds a new line."}
              </p>
            </div>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : null}
              {isPending ? "Running" : "Send"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
