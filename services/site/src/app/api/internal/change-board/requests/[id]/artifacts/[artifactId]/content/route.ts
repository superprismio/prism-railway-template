import { NextResponse } from "next/server"
import { getRequestArtifact, readRequestArtifactFile } from "@/lib/app-core"
import { requireServiceAccess } from "@/lib/internal-service"

type RouteContext = {
  params: Promise<{ id: string; artifactId: string }>
}

export async function GET(_request: Request, context: RouteContext) {
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
    const body = readRequestArtifactFile(artifact)
    return new NextResponse(body, {
      headers: {
        "content-type": artifact.mimeType,
        "content-length": String(body.byteLength),
        "content-disposition": `inline; filename="${artifact.name.replaceAll('"', "")}"`,
      },
    })
  } catch {
    return NextResponse.json({ ok: false, error: "Artifact file not found" }, { status: 404 })
  }
}
