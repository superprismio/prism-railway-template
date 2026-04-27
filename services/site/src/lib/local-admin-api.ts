import { cookies } from "next/headers"
import { loadConfig } from "@prism-railway/app-core"

import { adminPasswordCookieName } from "@/lib/admin"

export const targetEnvironmentKinds = ["production", "staging", "preview", "development"] as const
export const trackedChangeRequestStatuses = [
  "submitted",
  "triaging",
  "needs-human-input",
  "ready-for-agent",
  "in-progress",
  "awaiting-review",
  "changes-requested",
  "approved",
  "rejected",
  "closed",
] as const
export const trackedChangeRequestTypes = ["bug", "feature", "content", "design", "config", "ops"] as const
export const trackedChangeRequestPriorities = ["low", "normal", "high", "urgent"] as const

export function useLocalAppApi() {
  return process.env.SITE_USE_LOCAL_APP_API?.trim() === "true"
}

export async function requireLocalAdminAccess() {
  const password = (await cookies()).get(adminPasswordCookieName)?.value ?? null
  if (!password) {
    return { ok: false as const, status: 401, error: "Unauthorized" }
  }

  const config = loadConfig()
  if (password !== config.adminPassword) {
    return { ok: false as const, status: 401, error: "Unauthorized" }
  }

  return { ok: true as const }
}

export function parseString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export function parseNullableString(value: unknown) {
  if (value === null) return null
  return typeof value === "string" ? value.trim() : undefined
}

export function readRouteParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? ""
}

export function hasActiveExecutionStatus(status: string) {
  return status === "planned" || status === "running"
}
