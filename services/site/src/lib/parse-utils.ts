export function parseBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    return new Set(["1", "true", "yes", "on"]).has(value.trim().toLowerCase())
  }
  return fallback
}

export function parseConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
