import { NextResponse } from "next/server"
import {
  getRequestArtifact,
  readRequestArtifactFile,
  safeArtifactContentDisposition,
  safeArtifactMimeType,
} from "@/lib/app-core"
import { parseString, requireServiceAccess } from "@/lib/internal-service"

type RouteContext = {
  params: Promise<{ id: string; artifactId: string }>
}

function isTextArtifact(artifact: { mimeType: string | null; name: string }) {
  const mimeType = safeArtifactMimeType(artifact.mimeType).toLowerCase()
  const name = artifact.name.toLowerCase()
  return (
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    mimeType.includes("xml") ||
    mimeType.includes("yaml") ||
    mimeType.includes("csv") ||
    /\.(md|markdown|txt|json|jsonl|csv|xml|yaml|yml|html|css|js|jsx|ts|tsx)$/i.test(name)
  )
}

function artifactBodyJson(artifact: Awaited<ReturnType<typeof getRequestArtifact>>, body: Buffer, maxBytes: number) {
  if (!artifact) return null

  const text = isTextArtifact(artifact)
  const slice = body.subarray(0, Math.min(body.byteLength, maxBytes))
  return {
    artifact,
    content: text
      ? {
          encoding: "utf8",
          body: slice.toString("utf8"),
          truncated: body.byteLength > maxBytes,
          sizeBytes: body.byteLength,
        }
      : {
          encoding: "base64",
          body: slice.toString("base64"),
          truncated: body.byteLength > maxBytes,
          sizeBytes: body.byteLength,
        },
  }
}

export async function GET(request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id, artifactId } = await context.params
  const artifact = getRequestArtifact(artifactId)
  if (!artifact || artifact.requestId !== id) {
    return NextResponse.json({ ok: false, error: "Artifact not found" }, { status: 404 })
  }

  try {
    const body = await readRequestArtifactFile(artifact)
    const url = new URL(request.url)
    if (parseString(url.searchParams.get("format")).toLowerCase() === "json") {
      const maxBytes = Math.min(
        2_000_000,
        Math.max(1, Number.parseInt(url.searchParams.get("maxBytes") ?? "250000", 10) || 250_000),
      )
      return NextResponse.json({ ok: true, ...artifactBodyJson(artifact, body, maxBytes) })
    }
    return new NextResponse(body, {
      headers: {
        "content-type": safeArtifactMimeType(artifact.mimeType),
        "content-length": String(body.byteLength),
        "content-disposition": safeArtifactContentDisposition(artifact.name),
      },
    })
  } catch {
    return NextResponse.json({ ok: false, error: "Artifact file not found" }, { status: 404 })
  }
}
