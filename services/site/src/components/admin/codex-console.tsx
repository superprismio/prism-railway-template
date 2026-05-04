"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { Bot, LoaderCircle, Plus, Wrench } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

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

const skillOptions = [
  { id: "prism-api-reader", label: "Reader" },
  { id: "prism-api-writer", label: "Writer" },
  { id: "prism-api-ops", label: "Ops" },
] as const

const consoleSessionStorageKey = "prism-console-session-id"

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
  const [requestedSkills, setRequestedSkills] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [isPending, startTransition] = useTransition()
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const storedSessionId = window.localStorage.getItem(consoleSessionStorageKey)
    if (!storedSessionId) return

    setIsLoadingHistory(true)
    fetch(`/admin/responses?session_id=${encodeURIComponent(storedSessionId)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
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
        setSessionId(storedSessionId)
        setMessages(restoredMessages)
      })
      .catch(() => {
        window.localStorage.removeItem(consoleSessionStorageKey)
      })
      .finally(() => setIsLoadingHistory(false))
  }, [])

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
  }, [isActive, isLoadingHistory, messages.length])

  function toggleSkill(skillId: string) {
    setRequestedSkills((current) =>
      current.includes(skillId) ? current.filter((value) => value !== skillId) : [...current, skillId]
    )
  }

  function handleSubmit(formData: FormData) {
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

    startTransition(async () => {
      try {
        const response = await fetch("/admin/responses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            input: [{ role: "user", content: prompt }],
            session_id: sessionId,
            requested_skills: requestedSkills,
          }),
        })

        const payload = (await response.json()) as {
          error?: string
          output_text?: string
          session_id?: string
        }

        if (!response.ok || !payload.output_text) {
          throw new Error(payload.error || "The response endpoint did not return output_text")
        }

        const nextSessionId = payload.session_id ?? sessionId
        setSessionId(nextSessionId)
        if (nextSessionId) {
          window.localStorage.setItem(consoleSessionStorageKey, nextSessionId)
        }
        setMessages((current) => [
          ...current,
          {
            id: randomMessageId("assistant"),
            role: "assistant",
            content: payload.output_text!,
          },
        ])
      } catch (submitError) {
        const message = submitError instanceof Error ? submitError.message : "Unknown console error"
        setError(message)
      }
    })
  }

  function startNewSession() {
    window.localStorage.removeItem(consoleSessionStorageKey)
    setSessionId(null)
    setMessages([])
    setError(null)
  }

  return (
    <div className="flex h-[calc(100vh-248px)] min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4 md:px-6">
        <div className="flex flex-wrap gap-2">
          {skillOptions.map((skill) => {
            const active = requestedSkills.includes(skill.id)
            return (
              <button
                key={skill.id}
                type="button"
                onClick={() => toggleSkill(skill.id)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition ${
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-muted-foreground"
                }`}
              >
                <Wrench className="h-3 w-3" />
                {skill.label}
              </button>
            )
          })}
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
              if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
                return
              }
              event.preventDefault()
              if (!draft.trim() || isPending) return
              formRef.current?.requestSubmit()
            }}
            placeholder="Ask Codex about a request, review branch, preview state, or Prism context."
            className="min-h-28 rounded-none border-x-0 border-t-0 px-0 shadow-none focus-visible:ring-0"
            required
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Optional skills are forwarded as hints to the shared runtime.
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
