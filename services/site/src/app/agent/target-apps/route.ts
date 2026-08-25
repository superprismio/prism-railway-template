import { NextResponse } from "next/server"
import {
  createAuditLog,
  createTargetApp,
  createTargetEnvironment,
  listTargetApps,
  listTargetEnvironments,
} from "@/lib/app-core"

import { requireServiceAccess } from "@/lib/internal-service"

export async function GET() {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  return NextResponse.json({ ok: true, targetApps: listTargetApps() })
}

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function slug(value: unknown) {
  return text(value, 120).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

export async function POST(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }
  const body = record(await request.json().catch(() => null))
  const targetSlug = slug(body.slug)
  const name = text(body.name, 160)
  const repoUrl = text(body.repoUrl ?? body.repo_url, 2_000)
  const defaultBranch = text(body.defaultBranch ?? body.default_branch, 160) || "main"
  if (!targetSlug || !name || !repoUrl) {
    return NextResponse.json({ ok: false, error: "slug, name, and repoUrl are required" }, { status: 400 })
  }
  let parsedRepoUrl: URL
  try {
    parsedRepoUrl = new URL(repoUrl)
  } catch {
    return NextResponse.json({ ok: false, error: "repoUrl must be an absolute HTTPS URL" }, { status: 400 })
  }
  if (parsedRepoUrl.protocol !== "https:") {
    return NextResponse.json({ ok: false, error: "repoUrl must be an absolute HTTPS URL" }, { status: 400 })
  }
  const existing = listTargetApps().find((target) => target.slug === targetSlug)
  if (existing) {
    if (existing.repoUrl !== repoUrl) {
      return NextResponse.json({ ok: false, error: "TARGET_APP_SLUG_IN_USE" }, { status: 409 })
    }
    return NextResponse.json({
      ok: true,
      created: false,
      targetApp: existing,
      targetEnvironments: listTargetEnvironments(existing.id),
    })
  }
  try {
    const targetApp = createTargetApp({
      slug: targetSlug,
      name,
      description: text(body.description, 2_000) || null,
      repoUrl,
      repoProvider: text(body.repoProvider ?? body.repo_provider, 120) || "github",
      defaultBranch,
      framework: text(body.framework, 120) || null,
      deployBackend: text(body.deployBackend ?? body.deploy_backend, 120) || "github",
      deployConfig: record(body.deployConfig ?? body.deploy_config),
      agentEnabled: body.agentEnabled !== false && body.agent_enabled !== false,
    })
    if (!targetApp) throw new Error("TARGET_APP_CREATE_FAILED")
    const targetEnvironment = createTargetEnvironment({
      targetAppId: targetApp.id,
      slug: `${targetSlug}-development`,
      name: "Development",
      kind: "development",
      branch: defaultBranch,
      baseUrl: null,
      deployBackend: "local",
      deployConfig: { path: `/data/workspaces/${targetSlug}` },
      agentWritable: true,
      autoDeployEnabled: false,
      humanReviewRequired: true,
      isDefaultForAgent: true,
    })
    createAuditLog({
      actorUserId: null,
      actionType: "agent.target_app.create",
      targetType: "target_app",
      targetId: targetApp.id,
      meta: { slug: targetSlug, repoUrl, defaultBranch },
    })
    return NextResponse.json({ ok: true, created: true, targetApp, targetEnvironments: [targetEnvironment] }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "TARGET_APP_CREATE_FAILED" }, { status: 400 })
  }
}
