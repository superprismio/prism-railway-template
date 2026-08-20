"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Activity,
  ArrowUpRight,
  Bot,
  FlaskConical,
  Inbox,
  MessageSquareText,
  Settings,
} from "lucide-react"

import { ThemeToggle } from "@/components/shared/theme-toggle"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Capability } from "@/lib/role-access"

type LabSection = {
  label: string
  description: string
  href: string
  icon: typeof Inbox
  available: boolean
  capability: Capability
}

const labSections: readonly LabSection[] = [
  {
    label: "Requests",
    description: "Operational inbox",
    href: "/admin/lab",
    icon: Inbox,
    available: true,
    capability: "canViewRequests",
  },
  {
    label: "Admin Console",
    description: "Admin Agent control plane",
    href: "/admin/lab/console",
    icon: MessageSquareText,
    available: true,
    capability: "canRunAgent",
  },
  {
    label: "Agents",
    description: "Identity and activity",
    href: "/admin/lab/agents",
    icon: Bot,
    available: true,
    capability: "canRunAgent",
  },
  {
    label: "Activity",
    description: "Cross-request attention",
    href: "/admin/lab/activity",
    icon: Activity,
    available: true,
    capability: "canViewRequests",
  },
  {
    label: "Settings",
    description: "Focused configuration",
    href: "/admin/lab/settings",
    icon: Settings,
    available: true,
    capability: "canManageSettings",
  },
]

function LabNavigation({ compact = false, capabilities }: { compact?: boolean; capabilities: readonly Capability[] }) {
  const pathname = usePathname()
  const visibleSections = labSections.filter((section) => capabilities.includes(section.capability))

  if (compact) {
    return (
      <nav aria-label="Lab sections" className="overflow-x-auto border-b border-border/60 bg-card/35 lg:hidden">
        <ul className="flex min-w-max items-center gap-1 px-3 py-2">
          {visibleSections.map((section) => {
            const Icon = section.icon
            const active = section.available && (
              pathname === section.href ||
              (section.href !== "/admin/lab" && pathname.startsWith(`${section.href}/`)) ||
              (section.href === "/admin/lab" && pathname.startsWith("/admin/lab/requests"))
            )

            return (
              <li key={section.label}>
                {section.available ? (
                  <Link
                    href={section.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      buttonVariants({ variant: active ? "secondary" : "ghost", size: "sm" }),
                      "min-h-9",
                    )}
                  >
                    <Icon aria-hidden="true" />
                    {section.label}
                  </Link>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled
                    aria-label={`${section.label}, planned for a later Lab slice`}
                  >
                    <Icon aria-hidden="true" />
                    {section.label}
                    <span className="text-[0.625rem] uppercase tracking-wider">Soon</span>
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </nav>
    )
  }

  return (
    <nav aria-label="Lab sections" className="flex h-full flex-col">
      <p className="px-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Workspace
      </p>
      <ul className="mt-3 space-y-1">
        {visibleSections.map((section) => {
          const Icon = section.icon
          const active = section.available && (
            pathname === section.href ||
            (section.href !== "/admin/lab" && pathname.startsWith(`${section.href}/`)) ||
            (section.href === "/admin/lab" && pathname.startsWith("/admin/lab/requests"))
          )

          return (
            <li key={section.label}>
              {section.available ? (
                <Link
                  href={section.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-primary/12 text-foreground"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                  )}
                >
                  <Icon className={cn("h-4 w-4", active && "text-primary")} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block font-medium">{section.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{section.description}</span>
                  </span>
                </Link>
              ) : (
                <div
                  className="flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground/70"
                  aria-label={`${section.label}, planned for a later Lab slice`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 font-medium">
                      {section.label}
                      <span className="text-[0.625rem] uppercase tracking-[0.12em]">Planned</span>
                    </span>
                    <span className="block truncate text-xs">{section.description}</span>
                  </span>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <div className="mt-auto border-t border-border/60 pt-4">
        <p className="px-3 text-xs leading-5 text-muted-foreground">
          Lab uses live instance state. Return to the current UI for controls not yet available here.
        </p>
        <Link
          href="/admin"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3 w-full justify-between")}
        >
          Current admin UI
          <ArrowUpRight aria-hidden="true" />
        </Link>
      </div>
    </nav>
  )
}

function LabUnavailable() {
  return (
    <section
      aria-labelledby="lab-disabled-title"
      className="mx-auto flex min-h-[55vh] max-w-2xl items-center px-5 py-12 sm:px-8"
    >
      <div className="w-full border border-border/70 bg-card/70 p-6 shadow-sm sm:p-8">
        <Badge variant="muted">Feature disabled</Badge>
        <h1 id="lab-disabled-title" className="mt-4 text-2xl font-semibold tracking-tight">
          Prism Lab is not enabled
        </h1>
        <p className="mt-3 max-w-prose text-sm leading-6 text-muted-foreground">
          This instance has disabled the Lab route. No data or workflow state was changed. Use the current admin
          workspace while an operator reviews the rollout setting.
        </p>
        <Button asChild className="mt-6">
          <Link href="/admin">Open current admin UI</Link>
        </Button>
      </div>
    </section>
  )
}

export function LabShell({
  children,
  enabled = true,
  capabilities = [],
}: {
  children: ReactNode
  enabled?: boolean
  capabilities?: readonly Capability[]
}) {
  const showNavigation = enabled && capabilities.length > 0
  return (
    <div data-lab-shell className="min-h-screen w-full bg-background text-foreground">
      <a
        href="#lab-content"
        className="fixed left-3 top-3 z-50 -translate-y-20 bg-background px-3 py-2 text-sm font-medium shadow-lg focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to Lab content
      </a>

      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur">
        <div className="flex min-h-16 items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
              <FlaskConical className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold tracking-tight">Prism Operations</span>
                <Badge className="shrink-0 uppercase tracking-[0.12em]">Lab</Badge>
              </div>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">Live, field-testable workspace</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
              <Link href="/admin">
                Current UI
                <ArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="icon" className="sm:hidden">
              <Link href="/admin" aria-label="Open current admin UI">
                <ArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {showNavigation ? <LabNavigation compact capabilities={capabilities} /> : null}

      <div className={cn("mx-auto w-full max-w-[112rem]", showNavigation && "lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]")}>
        {showNavigation ? (
          <aside className="hidden min-h-[calc(100vh-4rem)] border-r border-border/60 bg-card/25 px-4 py-6 lg:block">
            <LabNavigation capabilities={capabilities} />
          </aside>
        ) : null}
        <main id="lab-content" tabIndex={-1} className="min-w-0 outline-none">
          {enabled ? children : <LabUnavailable />}
        </main>
      </div>
    </div>
  )
}
