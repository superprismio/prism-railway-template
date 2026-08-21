"use client"

import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Activity, ArrowUpRight, Brain, FlaskConical, Inbox, Menu, PanelLeftClose, Settings, X } from "lucide-react"

import { AgentAvatar } from "@/components/prism-lab/agent-avatar"
import { ThemeToggle } from "@/components/shared/theme-toggle"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Capability } from "@/lib/role-access"

export type LabAgentNavigationItem = { key: string; name: string; avatarUrl: string | null; accentColor: string; systemKey: string | null; status: string }

const workspaceSections = [
  { label: "Requests", href: "/admin/lab", icon: Inbox, capability: "canViewRequests" as const },
  { label: "Activity", href: "/admin/lab/activity", icon: Activity, capability: "canViewRequests" as const },
  { label: "Memory", href: "/admin/lab/memory", icon: Brain, capability: "canViewMemory" as const, requiresMemory: true },
  { label: "Settings", href: "/admin/lab/settings", icon: Settings, capability: "canManageSettings" as const },
]

function activeFor(pathname: string, href: string) {
  return pathname === href || (href === "/admin/lab" ? pathname.startsWith("/admin/lab/requests") : pathname.startsWith(`${href}/`))
}

function Navigator({ capabilities, agents, memoryConfigured, onNavigate }: { capabilities: readonly Capability[]; agents: readonly LabAgentNavigationItem[]; memoryConfigured: boolean; onNavigate?: () => void }) {
  const pathname = usePathname()
  const visibleWorkspace = workspaceSections.filter((item) => capabilities.includes(item.capability) && (!("requiresMemory" in item) || !item.requiresMemory || memoryConfigured))
  const visibleAgents = capabilities.includes("canChatAgents") ? agents.filter((agent) => agent.status !== "archived") : []
  return (
    <nav aria-label="Prism workspace and agents" className="flex h-full min-h-0 flex-col">
      <div className="px-3">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Workspace</p>
        <ul className="mt-2 space-y-0.5">
          {visibleWorkspace.map((item) => {
            const Icon = item.icon
            const active = activeFor(pathname, item.href)
            return <li key={item.href}><Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn("flex min-h-10 items-center gap-3 rounded-md px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "bg-primary/12 font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}><Icon className={cn("h-4 w-4", active && "text-primary")} aria-hidden="true" />{item.label}</Link></li>
          })}
        </ul>
      </div>
      {visibleAgents.length ? <div className="mt-6 min-h-0 flex-1 border-t border-border/50 pt-5">
        <div className="flex items-center justify-between px-3"><p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Agents</p><Link href="/admin/lab/agents" onClick={onNavigate} className="text-[0.68rem] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Manage</Link></div>
        <ul className="mt-2 max-h-full space-y-0.5 overflow-y-auto px-2">
          {visibleAgents.map((agent) => {
            const href = `/admin/lab/agents/${encodeURIComponent(agent.key)}`
            const active = activeFor(pathname, href)
            const labelColor = `color-mix(in oklab, ${agent.accentColor} 72%, var(--foreground))`
            return <li key={agent.key}><Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn("flex min-h-11 items-center gap-2.5 rounded-md border-l-2 px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "bg-primary/12 text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")} style={{ borderLeftColor: active ? agent.accentColor : "transparent" }}><AgentAvatar name={agent.name} avatarUrl={agent.avatarUrl} accentColor={agent.accentColor} className="h-7 w-7 rounded-md" /><span className="min-w-0 flex-1 truncate font-medium" style={{ color: labelColor }}>{agent.name}</span>{agent.systemKey === "admin-agent" ? <span className="text-[0.58rem] uppercase tracking-wider" style={{ color: labelColor }}>Admin</span> : null}</Link></li>
          })}
        </ul>
      </div> : null}
      <div className="mt-auto border-t border-border/50 p-3"><Link href="/admin" onClick={onNavigate} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-full justify-between text-muted-foreground")}>Current UI<ArrowUpRight aria-hidden="true" /></Link></div>
    </nav>
  )
}

function LabUnavailable() {
  return <section className="mx-auto flex min-h-[55vh] max-w-2xl items-center px-5 py-12"><div className="w-full border border-border/70 bg-card/70 p-6"><Badge variant="muted">Feature disabled</Badge><h1 className="mt-4 text-2xl font-semibold">Prism Lab is not enabled</h1><p className="mt-3 text-sm text-muted-foreground">Enable PRISM_LAB_ENABLED to use this field-test workspace.</p><Button asChild className="mt-6"><Link href="/admin">Open current admin UI</Link></Button></div></section>
}

export function LabShell({ children, enabled = true, capabilities = [], agents = [], memoryConfigured = false, branding }: { children: ReactNode; enabled?: boolean; capabilities?: readonly Capability[]; agents?: readonly LabAgentNavigationItem[]; memoryConfigured?: boolean; branding?: { brandName?: string; logoUrl?: string; logoAlt?: string; workspaceLabel?: string } }) {
  const showNavigation = enabled && capabilities.length > 0
  const [leftOpen, setLeftOpen] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => { setLeftOpen(window.localStorage.getItem("prism-lab-left-nav") !== "closed") }, [])
  function toggleLeft() { setLeftOpen((open) => { window.localStorage.setItem("prism-lab-left-nav", open ? "closed" : "open"); return !open }) }
  return <div data-lab-shell className="min-h-screen w-full bg-background text-foreground">
    <a href="#lab-content" className="fixed left-3 top-3 z-[70] -translate-y-20 bg-background px-3 py-2 text-sm focus:translate-y-0 focus:ring-2 focus:ring-ring">Skip to content</a>
    <header className="sticky top-0 z-50 flex h-14 items-center border-b border-border/60 bg-background/95 px-3 backdrop-blur">
      {showNavigation ? <><Button type="button" variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigator"><Menu /></Button><Button type="button" variant="ghost" size="icon" className="hidden lg:inline-flex" onClick={toggleLeft} aria-expanded={leftOpen} aria-controls="lab-agent-navigator" aria-label={leftOpen ? "Collapse navigator" : "Open navigator"}>{leftOpen ? <PanelLeftClose /> : <Menu />}</Button></> : null}
      <Link href="/admin/lab" className="ml-1 flex min-w-0 items-center gap-2" title={branding?.workspaceLabel || branding?.brandName || "Prism Lab"}><span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-primary/10 text-primary">{branding?.logoUrl ? <img src={branding.logoUrl} alt={branding.logoAlt || `${branding.brandName || "Workspace"} avatar`} className="h-full w-full object-cover" /> : <FlaskConical className="h-4 w-4" />}</span><span className="truncate text-sm font-semibold">Prism</span><Badge className="text-[0.58rem] uppercase tracking-wider">Lab</Badge><span className="hidden max-w-48 truncate border-l border-border/60 pl-2 text-xs text-muted-foreground sm:inline">{branding?.workspaceLabel || branding?.brandName || "Workspace"}</span></Link>
      <div className="ml-auto"><ThemeToggle /></div>
    </header>
    {showNavigation && mobileOpen ? <div className="fixed inset-0 z-[60] lg:hidden"><button className="absolute inset-0 bg-black/55" aria-label="Close navigator" onClick={() => setMobileOpen(false)} /><aside className="relative h-full w-[18rem] max-w-[88vw] border-r border-border bg-background pt-3 shadow-2xl"><div className="flex items-center justify-between px-3 pb-3"><span className="text-sm font-semibold">Navigator</span><Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close navigator"><X /></Button></div><Navigator capabilities={capabilities} agents={agents} memoryConfigured={memoryConfigured} onNavigate={() => setMobileOpen(false)} /></aside></div> : null}
    <div className={cn("min-h-[calc(100vh-3.5rem)]", showNavigation && leftOpen && "lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]")}>
      {showNavigation && leftOpen ? <aside id="lab-agent-navigator" className="sticky top-14 hidden h-[calc(100vh-3.5rem)] border-r border-border/60 bg-card/20 py-5 lg:block"><Navigator capabilities={capabilities} agents={agents} memoryConfigured={memoryConfigured} /></aside> : null}
      <main id="lab-content" tabIndex={-1} className="min-w-0 outline-none">{enabled ? children : <LabUnavailable />}</main>
    </div>
  </div>
}
