"use client"

import { useState, useTransition } from "react"
import { Bot, LoaderCircle, Wrench } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"

type ConsoleMessage = {
  id: string
  role: "user" | "assistant"
  content: string
}

const skillOptions = [
  { id: "prism-api-reader", label: "Reader" },
  { id: "prism-api-writer", label: "Writer" },
  { id: "prism-api-ops", label: "Ops" },
] as const

function randomMessageId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function CodexConsole() {
  const [draft, setDraft] = useState("")
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ConsoleMessage[]>([])
  const [requestedSkills, setRequestedSkills] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

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

        setSessionId(payload.session_id ?? sessionId)
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

  return (
    <Card className="rounded-[24px] border-border/60 bg-card/90">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Codex Console</CardTitle>
            <CardDescription>Admin chat backed by the API session model and shared Codex runtime.</CardDescription>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Bot className="h-4 w-4" />
            <span>{sessionId ? "Session live" : "New session"}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
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

        <div className="max-h-[360px] space-y-3 overflow-y-auto rounded-2xl border border-border/70 bg-background/60 p-4">
          {messages.length ? (
            messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-2xl px-4 py-3 text-sm leading-6 ${
                  message.role === "assistant"
                    ? "border border-border/70 bg-card text-foreground"
                    : "ml-6 bg-[#1d2433] text-white"
                }`}
              >
                <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.18em]">
                  <Badge variant={message.role === "assistant" ? "outline" : "secondary"}>{message.role}</Badge>
                </div>
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Start a session from the admin board. Session state stays in the API and resumes through Codex runtime.
            </div>
          )}
        </div>

        <form action={handleSubmit} className="space-y-3">
          <Textarea
            name="prompt"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask Codex about a request, staging target, deploy state, or Prism context."
            className="min-h-28"
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
        </form>
      </CardContent>
    </Card>
  )
}
