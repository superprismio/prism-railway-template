import { NextResponse } from "next/server"
import {
  getRequestArtifact,
  readRequestArtifactFile,
  safeArtifactContentDisposition,
  safeArtifactMimeType,
} from "@/lib/app-core"
import { verifyRequestArtifactUrlSignature } from "@/lib/request-artifact-signed-url"

type RouteContext = {
  params: Promise<{ id: string; artifactId: string }>
}

function readExpires(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export async function GET(request: Request, context: RouteContext) {
  const { id, artifactId } = await context.params
  const url = new URL(request.url)
  const expiresAt = readExpires(url.searchParams.get("expires"))
  const signature = url.searchParams.get("sig")?.trim() || ""

  if (
    !expiresAt ||
    !verifyRequestArtifactUrlSignature({
      requestId: id,
      artifactId,
      expiresAt,
      signature,
    })
  ) {
    return NextResponse.json({ ok: false, error: "Invalid or expired artifact URL" }, { status: 401 })
  }

  const artifact = getRequestArtifact(artifactId)
  if (!artifact || artifact.requestId !== id) {
    return NextResponse.json({ ok: false, error: "Artifact not found" }, { status: 404 })
  }

  try {
    const body = await readRequestArtifactFile(artifact)
    return new NextResponse(body, {
      headers: {
        "cache-control": "private, max-age=0, no-store",
        "content-type": safeArtifactMimeType(artifact.mimeType),
        "content-length": String(body.byteLength),
        "content-disposition": safeArtifactContentDisposition(artifact.name),
      },
    })
  } catch {
    return NextResponse.json({ ok: false, error: "Artifact file not found" }, { status: 404 })
  }
}
