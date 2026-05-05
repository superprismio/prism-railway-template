import { requireAdminSession } from "@/lib/admin-auth"

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
  return requireAdminSession()
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
