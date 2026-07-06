import { NextResponse } from "next/server"
import { getRequestArtifact } from "@/lib/app-core"
import { parseString, readOptionalInteger, requireServiceAccess } from "@/lib/internal-service"
import {
  artifactSignedUrlExpiresAt,
  buildSignedRequestArtifactUrl,
} from "@/lib/request-artifact-signed-url"

type RouteContext = {
  params: Promise<{ id: string; artifactId: string }>
}

function parsePayload(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function parseTtlSeconds(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value)
  }
  return readOptionalInteger(parseString(value) || null)
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id, artifactId } = await context.params
  const artifact = getRequestArtifact(artifactId)
  if (!artifact || artifact.requestId !== id) {
    return NextResponse.json({ ok: false, error: "Artifact not found" }, { status: 404 })
  }

  let payload: unknown = null
  try {
    payload = await request.json()
  } catch {
    payload = null
  }

  const body = parsePayload(payload)
  const ttlSeconds =
    parseTtlSeconds(body.ttlSeconds ?? body.ttl_seconds) ??
    readOptionalInteger(new URL(request.url).searchParams.get("ttlSeconds"))
  const expiresAt = artifactSignedUrlExpiresAt(ttlSeconds)
  const signedUrl = buildSignedRequestArtifactUrl({
    request,
    requestId: id,
    artifactId,
    expiresAt,
  })

  return NextResponse.json({
    ok: true,
    artifact,
    signedUrl,
    expiresAt,
    expiresAtIso: new Date(expiresAt * 1000).toISOString(),
  })
}
