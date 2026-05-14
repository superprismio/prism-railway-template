import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import {
  buildRequestArtifactStoragePath,
  createRequestArtifact,
  createWorkflowEvent,
  deleteRequestArtifact,
  deleteRequestArtifactFile,
  getChangeRequest,
  getWorkflowRunForRequest,
  writeRequestArtifactFile,
} from "@/lib/app-core"
import { parseString, readRouteParam, requireLocalCommentAccess, useLocalAppApi } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ id: string }>
}

function maxUploadBytes() {
  const rawMb = Number.parseInt(process.env.ARTIFACT_MAX_UPLOAD_MB ?? "50", 10)
  const safeMb = Number.isFinite(rawMb) ? Math.max(1, Math.min(rawMb, 500)) : 50
  return safeMb * 1024 * 1024
}

export async function POST(request: Request, context: RouteContext) {
  if (!useLocalAppApi()) {
    return NextResponse.json(
      { ok: false, error: "Artifact uploads require the local site API" },
      { status: 501 },
    )
  }

  const access = await requireLocalCommentAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id } = await context.params
  const requestId = readRouteParam(id)
  if (!getChangeRequest(requestId)) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid upload body" }, { status: 400 })
  }

  const file = formData.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "file is required" }, { status: 400 })
  }
  if (!file.name || file.size <= 0) {
    return NextResponse.json({ ok: false, error: "Uploaded file is empty" }, { status: 400 })
  }

  const maxBytes = maxUploadBytes()
  if (file.size > maxBytes) {
    return NextResponse.json(
      { ok: false, error: `File exceeds ${Math.round(maxBytes / 1024 / 1024)} MB upload limit` },
      { status: 413 },
    )
  }

  const artifactId = randomUUID()
  const name = parseString(formData.get("name")) || file.name
  const storagePath = buildRequestArtifactStoragePath({ requestId, artifactId, name })
  const content = Buffer.from(await file.arrayBuffer())

  try {
    await writeRequestArtifactFile(storagePath, content)
    const artifact = createRequestArtifact({
      id: artifactId,
      requestId,
      workflowRunId: null,
      executionId: null,
      kind: parseString(formData.get("kind")) || "upload",
      name,
      description: parseString(formData.get("description")) || null,
      mimeType: file.type || "application/octet-stream",
      storagePath,
      sizeBytes: content.byteLength,
      metadata: {
        source: "admin-upload",
        originalName: file.name,
      },
      createdBy: "admin",
    })

    const workflowRun = getWorkflowRunForRequest(requestId)
    if (workflowRun) {
      createWorkflowEvent({
        workflowRunId: workflowRun.id,
        requestId,
        stepKey: workflowRun.currentStepKey,
        eventType: "artifact.created",
        actorType: "admin",
        payload: {
          artifactId: artifact.id,
          kind: artifact.kind,
          name: artifact.name,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
        },
      })
    }

    return NextResponse.json({ ok: true, artifact }, { status: 201 })
  } catch (error) {
    deleteRequestArtifact(artifactId)
    await deleteRequestArtifactFile(storagePath).catch(() => undefined)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not upload artifact" },
      { status: 500 },
    )
  }
}
