import { createHmac, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import { loadConfig } from "@/lib/app-core"
import { capabilitiesForRoles, hasCapability, type Capability } from "@/lib/role-access"

export const adminSessionCookieName = "prism_admin_session"
export const legacyAdminPasswordCookieName = "prism_admin_password"

type AdminSessionPayload = {
  v: 1
  iat: number
  exp: number
  userId?: string | null
  roleSlugs?: string[]
}

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url")
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8")
}

function signingSecret() {
  const config = loadConfig()
  const rootSecret =
    process.env.ADMIN_SESSION_SECRET?.trim() ||
    process.env.INTERNAL_SERVICE_TOKEN?.trim() ||
    process.env.SERVICE_SHARED_TOKEN?.trim() ||
    process.env.APP_API_SERVICE_TOKEN?.trim() ||
    config.adminPassword

  return createHmac("sha256", rootSecret)
    .update("prism-admin-session:v1")
    .digest()
}

function signPayload(payload: string) {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url")
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }
  return timingSafeEqual(leftBuffer, rightBuffer)
}

export function adminSessionMaxAgeSeconds() {
  const configured = Math.floor(loadConfig().sessionMaxAgeMs / 1000)
  return Number.isFinite(configured) && configured > 0 ? configured : 60 * 60 * 24 * 30
}

export function createAdminSessionCookieValue(input?: { userId?: string | null; roleSlugs?: string[] }) {
  const now = Math.floor(Date.now() / 1000)
  const payload: AdminSessionPayload = {
    v: 1,
    iat: now,
    exp: now + adminSessionMaxAgeSeconds(),
    userId: input?.userId ?? null,
    roleSlugs: input?.roleSlugs?.length ? input.roleSlugs : ["admin"],
  }
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  return `${encodedPayload}.${signPayload(encodedPayload)}`
}

export function verifyAdminSessionCookieValue(value: string | null | undefined) {
  if (!value) {
    return { ok: false as const, reason: "missing" as const }
  }

  const [encodedPayload, signature, extra] = value.split(".")
  if (!encodedPayload || !signature || extra !== undefined) {
    return { ok: false as const, reason: "invalid" as const }
  }

  if (!safeEqual(signPayload(encodedPayload), signature)) {
    return { ok: false as const, reason: "invalid" as const }
  }

  let payload: AdminSessionPayload
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as AdminSessionPayload
  } catch {
    return { ok: false as const, reason: "invalid" as const }
  }

  if (payload.v !== 1 || !Number.isFinite(payload.exp)) {
    return { ok: false as const, reason: "invalid" as const }
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false as const, reason: "expired" as const }
  }

  return { ok: true as const, payload }
}

export async function getAdminSessionCookie() {
  return (await cookies()).get(adminSessionCookieName)?.value ?? null
}

export async function requireAdminSession() {
  const result = verifyAdminSessionCookieValue(await getAdminSessionCookie())
  if (!result.ok) {
    return { ok: false as const, status: 401, error: "Unauthorized", reason: result.reason }
  }

  const roleSlugs = result.payload.roleSlugs?.length ? result.payload.roleSlugs : ["admin"]

  return {
    ok: true as const,
    userId: result.payload.userId ?? null,
    roleSlugs,
    capabilities: [...capabilitiesForRoles(roleSlugs)],
  }
}

export async function requireCapabilityAccess(capability: Capability) {
  const session = await requireAdminSession()
  if (!session.ok) {
    return session
  }

  if (!hasCapability(session.roleSlugs, capability)) {
    return { ok: false as const, status: 403, error: "Forbidden", reason: "missing-capability" as const }
  }

  return session
}

export async function requireAdminAccess() {
  return requireCapabilityAccess("canManageSettings")
}

export async function requireModeratorAccess() {
  return requireCapabilityAccess("canRunAgent")
}

export async function requireMemberAccess() {
  return requireCapabilityAccess("canViewWorkspace")
}
