import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import {
  buildRequestArtifactStoragePath,
  createRequestArtifact,
  createWorkflowEvent,
  deleteRequestArtifact,
  deleteRequestArtifactFile,
  getAgentRun,
  getChangeRequest,
  getWorkflowRunForRequest,
  writeRequestArtifactFile,
} from "@/lib/app-core"
import { parseString, requireServiceAccess } from "@/lib/internal-service"

type AttachmentLane = "request-artifact" | "workflow-input"

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function adapterBaseUrl() {
  return (
    process.env.COMMUNICATION_ADAPTER_BASE_URL ??
    process.env.SOURCE_ADAPTER_BASE_URL ??
    ""
  ).trim().replace(/\/+$/, "")
}

function adapterToken() {
  return (
    process.env.COMMUNICATION_ADAPTER_TOKEN ??
    process.env.SOURCE_ADAPTER_TOKEN ??
    ""
  ).trim()
}

function maxAttachmentBytes() {
  const rawMb = Number.parseInt(process.env.ARTIFACT_MAX_UPLOAD_MB ?? "50", 10)
  const safeMb = Number.isFinite(rawMb) ? Math.max(1, Math.min(rawMb, 500)) : 50
  return safeMb * 1024 * 1024
}

function parseLane(value: unknown): AttachmentLane | null {
  const lane = parseString(value) || "request-artifact"
  if (lane === "request-artifact" || lane === "workflow-input") {
    return lane
  }
  return null
}

function decodeMetadataHeader(value: string | null) {
  if (!value) return {}
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function fallbackFilenameFromDisposition(value: string | null) {
  if (!value) return ""
  const match = value.match(/filename="([^"]+)"/i)
  return match?.[1]?.trim() ?? ""
}

function safeFilename(value: string) {
  return value
    .trim()
    .replace(/[/\\]+/g, "-")
    .replace(/[\x00-\x1F\x7F"\\]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "attachment"
}

async function fetchSourceAttachment(input: {
  platform: string
  channelId: string
  messageId: string
  attachmentId: string
  purpose: string
}) {
  const baseUrl = adapterBaseUrl()
  const token = adapterToken()
  if (!baseUrl || !token) {
    throw new Error("COMMUNICATION_ADAPTER_BASE_URL and COMMUNICATION_ADAPTER_TOKEN are required")
  }

  const response = await fetch(`${baseUrl}/attachments/fetch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Adapter-Token": token,
    },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "")
    throw new Error(`ATTACHMENT_FETCH_FAILED:${response.status}:${errorBody.slice(0, 300)}`)
  }

  const content = Buffer.from(await response.arrayBuffer())
  const maxBytes = maxAttachmentBytes()
  if (content.byteLength > maxBytes) {
    throw new Error(`ATTACHMENT_TOO_LARGE:${content.byteLength}:${maxBytes}`)
  }

  const metadata = decodeMetadataHeader(response.headers.get("x-prism-attachment-metadata"))
  const filename =
    parseString(metadata.filename) ||
    fallbackFilenameFromDisposition(response.headers.get("content-disposition")) ||
    `${input.attachmentId}.bin`
  const contentType =
    parseString(metadata.contentType ?? metadata.content_type) ||
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "application/octet-stream"

  return {
    content,
    metadata,
    filename: safeFilename(filename),
    contentType,
  }
}

export async function POST(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  let payload: unknown = null
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }
  const body = isRecord(payload) ? payload : {}

  const platform = parseString(body.platform) || "discord"
  const requestId = parseString(body.requestId ?? body.request_id)
  const channelId = parseString(body.channelId ?? body.channel_id)
  const messageId = parseString(body.messageId ?? body.message_id)
  const attachmentId = parseString(body.attachmentId ?? body.attachment_id)
  const purpose = parseString(body.purpose) || "request-artifact"
  const lane = parseLane(body.lane)
  const agentRunId = parseString(body.agentRunId ?? body.agent_run_id) || null

  if (!lane) {
    return NextResponse.json(
      { ok: false, error: "Unsupported lane. Use request-artifact or workflow-input for this first slice." },
      { status: 400 },
    )
  }
  if (platform !== "discord") {
    return NextResponse.json({ ok: false, error: "Unsupported platform" }, { status: 400 })
  }
  if (!requestId || !channelId || !messageId || !attachmentId) {
    return NextResponse.json(
      { ok: false, error: "requestId, channelId, messageId, and attachmentId are required" },
      { status: 400 },
    )
  }
  const changeRequest = getChangeRequest(requestId)
  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }
  if (agentRunId) {
    const agentRun = getAgentRun(agentRunId)
    if (!agentRun || agentRun.requestId !== requestId) {
      return NextResponse.json({ ok: false, error: "Invalid agentRunId" }, { status: 400 })
    }
  }

  let fetched: Awaited<ReturnType<typeof fetchSourceAttachment>>
  try {
    fetched = await fetchSourceAttachment({ platform, channelId, messageId, attachmentId, purpose })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status =
      message.startsWith("ATTACHMENT_FETCH_FAILED:404:") ? 404
      : message.startsWith("ATTACHMENT_TOO_LARGE:") ? 413
      : message.includes("COMMUNICATION_ADAPTER_BASE_URL") ? 503
      : 502
    return NextResponse.json({ ok: false, error: message }, { status })
  }

  const artifactId = randomUUID()
  const name = safeFilename(parseString(body.name) || fetched.filename)
  const storagePath = buildRequestArtifactStoragePath({ requestId, artifactId, name })
  const workflowRun = getWorkflowRunForRequest(requestId)

  try {
    await writeRequestArtifactFile(storagePath, fetched.content)
    const artifact = createRequestArtifact({
      id: artifactId,
      agentRunId,
      requestId,
      workflowRunId: workflowRun?.id ?? null,
      executionId: null,
      kind: lane === "workflow-input" ? "workflow-input" : "source-attachment",
      name,
      description: parseString(body.description) || `Fetched ${platform} attachment ${attachmentId}`,
      mimeType: fetched.contentType,
      storagePath,
      sizeBytes: fetched.content.byteLength,
      metadata: {
        source: "source-attachment",
        platform,
        lane,
        purpose,
        fetchedAt: new Date().toISOString(),
        sourceAttachment: fetched.metadata,
        requestedBy: parseString(body.requestedBy ?? body.requested_by) || null,
      },
      createdBy: "source-attachment",
    })

    if (workflowRun) {
      createWorkflowEvent({
        workflowRunId: workflowRun.id,
        requestId,
        stepKey: workflowRun.currentStepKey,
        eventType: "artifact.created",
        actorType: "agent",
        payload: {
          artifactId: artifact.id,
          agentRunId: artifact.agentRunId,
          kind: artifact.kind,
          name: artifact.name,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          source: "source-attachment",
          platform,
        },
      })
    }

    return NextResponse.json({ ok: true, artifact }, { status: 201 })
  } catch (error) {
    deleteRequestArtifact(artifactId)
    await deleteRequestArtifactFile(storagePath).catch(() => undefined)
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
