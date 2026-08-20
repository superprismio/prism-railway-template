"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Link2, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function AgentBindingForm({ profileKey }: { profileKey: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(formData: FormData) {
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/admin/agent-profiles/${encodeURIComponent(profileKey)}/bindings`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
          surfaceType: String(formData.get("surfaceType") ?? ""), surfaceKey: String(formData.get("surfaceKey") ?? ""), label: String(formData.get("label") ?? ""),
        }),
      })
      const payload = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Binding could not be saved")
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Binding could not be saved")
    } finally {
      setPending(false)
    }
  }
  return (
    <form action={submit} className="grid gap-3 border border-border/60 p-4 sm:grid-cols-3">
      <div className="space-y-1.5"><Label htmlFor="binding-type">Surface</Label><select id="binding-type" name="surfaceType" className="flex h-10 w-full border border-input bg-background px-3 text-sm">{["buzz", "discord", "telegram", "external", "user"].map((value) => <option key={value}>{value}</option>)}</select></div>
      <div className="space-y-1.5"><Label htmlFor="binding-key">Channel / surface ID</Label><Input id="binding-key" name="surfaceKey" required /></div>
      <div className="space-y-1.5"><Label htmlFor="binding-label">Label</Label><Input id="binding-label" name="label" /></div>
      {error ? <p className="text-sm text-destructive sm:col-span-3" role="alert">{error}</p> : null}
      <div className="sm:col-span-3"><Button type="submit" size="sm" disabled={pending}>{pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Link2 aria-hidden="true" />}Add or move binding</Button></div>
    </form>
  )
}
