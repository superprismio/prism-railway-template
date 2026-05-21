"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Bot, LoaderCircle, Plus } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { describeFetchError, readApiError } from "@/lib/client-api-errors"

type ConsoleMessage = {
  id: string
  role: "user" | "assistant"
  content: string
}

type StoredConsoleMessage = {
  id: string
  role: string
  content: string
}

const consoleSessionStorageKey = "prism-console-session-id"
const consoleActiveJobStorageKey = "prism-console-active-job-id"

function randomMessageId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function scrollToLatestMessage(element: HTMLDivElement | null, behavior: ScrollBehavior = "auto") {
  if (!element) return
  element.scrollTo({
    top: element.scrollHeight,
    behavior,
  })
}

export function CodexConsole({ isActive = true }: { isActive?: boolean }) {
  const [draft, setDraft] = useState("")
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ConsoleMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const isPending = isSubmitting || Boolean(activeJobId)

  const loadConsoleHistory = useCallback(async (targetSessionId: string) => {
    const response = await fetch(`/admin/responses?session_id=${encodeURIComponent(targetSessionId)}`, {
      cache: "no-store",
    })
    const payload = (await response.json()) as {
      ok?: boolean
      messages?: StoredConsoleMessage[]
      error?: string
    }
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "Could not load console history")
    }
    const restoredMessages = Array.isArray(payload.messages)
      ? payload.messages
          .filter((message) => message.role === "user" || message.role === "assistant")
          .map((message) => ({
            id: message.id,
            role: message.role as "user" | "assistant",
            content: message.content,
          }))
      : []
    setSessionId(targetSessionId)
    setMessages(restoredMessages)
  }, [])

  useEffect(() => {
    const storedSessionId = window.localStorage.getItem(consoleSessionStorageKey)
    const storedJobId = window.localStorage.getItem(consoleActiveJobStorageKey)
    if (storedJobId) {
      setActiveJobId(storedJobId)
    }
    if (!storedSessionId) return

    setIsLoadingHistory(true)
    loadConsoleHistory(storedSessionId)
      .catch(() => {
        window.localStorage.removeItem(consoleSessionStorageKey)
      })
      .finally(() => setIsLoadingHistory(false))
  }, [loadConsoleHistory])

  useEffect(() => {
    scrollToLatestMessage(transcriptRef.current, messages.length > 1 ? "smooth" : "auto")
  }, [isActive, isLoadingHistory, messages.length, isPending])

  useEffect(() => {
    if (!isActive) return
    const focusInput = () => {
      scrollToLatestMessage(transcriptRef.current)
      inputRef.current?.focus({ preventScroll: true })
    }
    const frameId = window.requestAnimationFrame(focusInput)
    const timeoutId = window.setTimeout(focusInput, 80)
    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
    }
  }, [isActive, isLoadingHistory])

  useEffect(() => {
    if (!activeJobId) return
    let canceled = false
    let timeoutId: number | null = null

    async function pollJob() {
      try {
        const response = await fetch(`/admin/console/jobs/${encodeURIComponent(activeJobId!)}`, {
          cache: "no-store",
        })
        if (!response.ok) {
          throw new Error(await readApiError(response, "Could not load Prism Console job"))
        }
        const payload = (await response.json()) as {
          ok?: boolean
          job?: {
            id: string
            status: string
            sessionId?: string | null
            outputText?: string | null
            errorMessage?: string | null
          }
        }
        const job = payload.job
        if (!job) {
          throw new Error("Console job response did not include a job")
        }
        if (job.sessionId) {
          setSessionId(job.sessionId)
          window.localStorage.setItem(consoleSessionStorageKey, job.sessionId)
        }
        if (job.status === "succeeded") {
          window.localStorage.removeItem(consoleActiveJobStorageKey)
          setActiveJobId(null)
          setError(null)
          const nextSessionId = job.sessionId ?? sessionId
          if (nextSessionId) {
            try {
              await loadConsoleHistory(nextSessionId)
            } catch (historyError) {
              setError(describeFetchError(historyError, "Could not refresh Prism Console history"))
            }
          }
          return
        }
        if (job.status === "failed" || job.status === "canceled") {
          window.localStorage.removeItem(consoleActiveJobStorageKey)
          setActiveJobId(null)
          setError(job.errorMessage || `Console job ${job.status}`)
          return
        }
      } catch (pollError) {
        window.localStorage.removeItem(consoleActiveJobStorageKey)
        setActiveJobId(null)
        setError(describeFetchError(pollError, "Could not run Prism Console"))
        return
      }

      if (!canceled) {
        timeoutId = window.setTimeout(pollJob, 1500)
      }
    }

    void pollJob()
    return () => {
      canceled = true
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [activeJobId, loadConsoleHistory, sessionId])

  async function handleSubmit(formData: FormData) {
    const prompt = String(formData.get("prompt") ?? "").trim()
    if (!prompt) return

    const userMessage: ConsoleMessage = {
      id: randomMessageId("user"),
      role: "user",
      content: prompt,
    }

    setDraft("")
    setError(null)
    setMessages((current) => [...current, userMessage])
    setIsSubmitting(true)

    try {
      const response = await fetch("/admin/console/jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: [{ role: "user", content: prompt }],
          session_id: sessionId,
        }),
      })

      if (!response.ok) {
        throw new Error(await readApiError(response, "Could not start Prism Console job"))
      }
      const payload = (await response.json().catch(() => null)) as {
        jobId?: string
        session_id?: string
      } | null

      if (!payload?.jobId) {
        throw new Error("Console job endpoint did not return jobId")
      }
      if (payload.session_id) {
        setSessionId(payload.session_id)
        window.localStorage.setItem(consoleSessionStorageKey, payload.session_id)
      }
      window.localStorage.setItem(consoleActiveJobStorageKey, payload.jobId)
      setActiveJobId(payload.jobId)
    } catch (submitError) {
      setError(describeFetchError(submitError, "Could not run Prism Console"))
    } finally {
      setIsSubmitting(false)
    }
  }

  function startNewSession() {
    window.localStorage.removeItem(consoleSessionStorageKey)
    setSessionId(null)
    setMessages([])
    setError(null)
    setActiveJobId(null)
    window.localStorage.removeItem(consoleActiveJobStorageKey)
  }

  return (
    <div className="flex h-[calc(100vh-248px)] min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4 md:px-6">
        <div className="text-sm text-muted-foreground">
          {isPending ? "Prism is working..." : "Shared Prism session"}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Bot className="h-4 w-4" />
            <span>{sessionId ? "Session live" : "New session"}</span>
          </div>
          {sessionId ? (
            <Button type="button" variant="outline" size="sm" onClick={startNewSession}>
              <Plus className="h-4 w-4" />
              New
            </Button>
          ) : null}
        </div>
      </div>

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
                  <Badge variant={message.role === "assistant" ? "outline" : "secondary"}>
                    {message.role}
                  </Badge>
                </div>
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
            ))
          ) : (
            <div className="border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Start a session from the admin board. Session history is stored in the API and restored in this browser.
            </div>
          )}
        </div>
      </div>

      <form ref={formRef} action={handleSubmit} className="border-t border-border/60 px-5 py-4 md:px-6">
        <div className="space-y-3">
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
                event.nativeEvent.isComposing
              ) {
                return
              }
              event.preventDefault()
              if (!draft.trim() || isPending) return
              formRef.current?.requestSubmit()
            }}
            placeholder="Ask Codex about a request, review branch, preview state, or Prism context."
            className="min-h-28 rounded-none border-x-0 border-t-0 px-0 shadow-none focus-visible:ring-0"
            disabled={isPending}
            required
          />
          {activeJobId ? (
            <p className="text-sm text-muted-foreground">Prism is working in the background. You can keep this tab open while the job runs.</p>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Enter sends. Shift+Enter adds a new line.
            </p>
            <Button type="submit" disabled={isPending}>
              {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              {isPending ? "Running" : "Send"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
