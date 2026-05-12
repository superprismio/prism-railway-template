import { NextResponse } from "next/server"
import {
  getChangeRequestByNumber,
  listRequestArtifacts,
  readRequestArtifactFile,
  safeArtifactMimeType,
} from "@/lib/app-core"
import { parseString, readOptionalInteger, requireServiceAccess } from "@/lib/internal-service"

type RouteContext = {
  params: Promise<{ requestNumber: string }>
}

function readRequestNumber(value: string) {
  if (!/^\d+$/.test(value)) {
    return null
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
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

function readBoolean(value: string | null, fallback: boolean) {
  if (value === null) return fallback
  return new Set(["1", "true", "yes", "on"]).has(value.trim().toLowerCase())
}

export async function GET(request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { requestNumber: rawRequestNumber } = await context.params
  const requestNumber = readRequestNumber(rawRequestNumber)
  if (!requestNumber) {
    return NextResponse.json({ ok: false, error: "Invalid request number" }, { status: 400 })
  }

  const changeRequest = getChangeRequestByNumber(requestNumber)
  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  const url = new URL(request.url)
  const rawLimit = readOptionalInteger(url.searchParams.get("limit")) ?? 100
  const limit = Math.min(500, Math.max(1, rawLimit))
  const maxBytes = Math.min(
    2_000_000,
    Math.max(1, readOptionalInteger(url.searchParams.get("maxBytes")) ?? 250_000),
  )
  const includeContent = readBoolean(url.searchParams.get("includeContent"), true)
  const includeBinary = readBoolean(url.searchParams.get("includeBinary"), false)
  const nameFilter = parseString(url.searchParams.get("name"))
  const kindFilter = parseString(url.searchParams.get("kind"))
  const artifactIdFilter = parseString(url.searchParams.get("artifactId") ?? url.searchParams.get("artifact_id"))

  let artifacts = listRequestArtifacts(changeRequest.id, limit)
  if (artifactIdFilter) {
    artifacts = artifacts.filter((artifact) => artifact.id === artifactIdFilter)
  }
  if (nameFilter) {
    artifacts = artifacts.filter((artifact) => artifact.name === nameFilter)
  }
  if (kindFilter) {
    artifacts = artifacts.filter((artifact) => artifact.kind === kindFilter)
  }

  const hydratedArtifacts = await Promise.all(
    artifacts.map(async (artifact) => {
      if (!includeContent) {
        return { ...artifact, content: null }
      }

      const textArtifact = isTextArtifact(artifact)
      if (!textArtifact && !includeBinary) {
        return {
          ...artifact,
          content: {
            encoding: null,
            body: null,
            omitted: true,
            reason: "binary-content",
            sizeBytes: artifact.sizeBytes,
          },
        }
      }

      try {
        const body = await readRequestArtifactFile(artifact)
        const slice = body.subarray(0, Math.min(body.byteLength, maxBytes))
        return {
          ...artifact,
          content: {
            encoding: textArtifact ? "utf8" : "base64",
            body: textArtifact ? slice.toString("utf8") : slice.toString("base64"),
            truncated: body.byteLength > maxBytes,
            sizeBytes: body.byteLength,
          },
        }
      } catch {
        return {
          ...artifact,
          content: {
            encoding: null,
            body: null,
            omitted: true,
            reason: "artifact-file-not-found",
            sizeBytes: artifact.sizeBytes,
          },
        }
      }
    }),
  )

  return NextResponse.json({
    ok: true,
    request: {
      id: changeRequest.id,
      requestNumber: changeRequest.requestNumber,
      title: changeRequest.title,
      workflowKey: changeRequest.workflowKey,
      currentWorkflowStepKey: changeRequest.currentWorkflowStepKey,
    },
    artifacts: hydratedArtifacts,
  })
}
