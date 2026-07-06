import { createHmac, timingSafeEqual } from "node:crypto"
import { getInternalServiceToken } from "@/lib/internal-service"
import { publicUrlFromRequest } from "@/lib/public-url"

const defaultTtlSeconds = 60 * 60
const maxTtlSeconds = 60 * 60 * 24

function signingSecret() {
  return process.env.PRISM_ARTIFACT_SIGNING_SECRET?.trim() || getInternalServiceToken()
}

function signaturePayload(input: {
  requestId: string
  artifactId: string
  expiresAt: number
}) {
  return `${input.requestId}.${input.artifactId}.${input.expiresAt}`
}

export function artifactSignedUrlExpiresAt(ttlSeconds?: number | null) {
  const ttl = Number.isFinite(ttlSeconds)
    ? Math.min(maxTtlSeconds, Math.max(60, Math.trunc(ttlSeconds as number)))
    : defaultTtlSeconds
  return Math.floor(Date.now() / 1000) + ttl
}

export function signRequestArtifactUrl(input: {
  requestId: string
  artifactId: string
  expiresAt: number
}) {
  return createHmac("sha256", signingSecret())
    .update(signaturePayload(input))
    .digest("base64url")
}

export function verifyRequestArtifactUrlSignature(input: {
  requestId: string
  artifactId: string
  expiresAt: number
  signature: string
}) {
  if (!input.signature || input.expiresAt < Math.floor(Date.now() / 1000)) {
    return false
  }

  const expected = Buffer.from(signRequestArtifactUrl(input))
  const received = Buffer.from(input.signature)
  return expected.byteLength === received.byteLength && timingSafeEqual(expected, received)
}

export function buildSignedRequestArtifactUrl(input: {
  request: Request
  requestId: string
  artifactId: string
  expiresAt: number
}) {
  const path = `/api/request-artifacts/${encodeURIComponent(input.requestId)}/${encodeURIComponent(input.artifactId)}/content`
  const url = new URL(publicUrlFromRequest(input.request, path))
  url.searchParams.set("expires", String(input.expiresAt))
  url.searchParams.set("sig", signRequestArtifactUrl(input))
  return url.toString()
}
