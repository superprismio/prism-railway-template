import { redirect } from "next/navigation"
import { createAuditLog, createTargetEnvironment } from "@/lib/app-core"

import { adminFetch } from "@/lib/admin"
import {
  requireLocalAdminAccess,
  targetEnvironmentKinds,
  useLocalAppApi,
} from "@/lib/local-admin-api"

function slugFromName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export async function POST(request: Request) {
  const formData = await request.formData()
  const name = String(formData.get("name") ?? "").trim()
  const slug = String(formData.get("slug") ?? "").trim() || slugFromName(name)
  const targetAppId = String(formData.get("targetAppId") ?? "").trim()
  const kind = String(formData.get("kind") ?? "development").trim() || "development"

  if (useLocalAppApi()) {
    const access = await requireLocalAdminAccess()
    if (!access.ok) {
      redirect("/admin?tab=settings&error=unauthorized")
    }

    if (!targetAppId || !slug || !name || !targetEnvironmentKinds.includes(kind as typeof targetEnvironmentKinds[number])) {
      redirect("/admin?tab=settings&error=target-environment")
    }

    const targetEnvironment = createTargetEnvironment({
      targetAppId,
      slug,
      name,
      kind,
      branch: String(formData.get("branch") ?? "main").trim() || "main",
      baseUrl: String(formData.get("baseUrl") ?? "").trim() || null,
      deployBackend: "local",
      deployConfig: {
        path: "/data/workspaces",
      },
      agentWritable: formData.get("agentWritable") === "on",
      autoDeployEnabled: false,
      humanReviewRequired: formData.get("humanReviewRequired") === "on",
      isDefaultForAgent: formData.get("isDefaultForAgent") === "on",
    })

    createAuditLog({
      actorUserId: null,
      actionType: "admin.target_environment.create",
      targetType: "target_environment",
      targetId: targetEnvironment?.id ?? null,
      meta: { targetAppId, slug, kind, deployBackend: "local" },
    })

    redirect("/admin?tab=settings")
  }

  const response = await adminFetch("/api/admin/target-environments", {
    method: "POST",
    body: JSON.stringify({
      targetAppId,
      slug,
      name,
      kind,
      branch: String(formData.get("branch") ?? "main").trim() || "main",
      baseUrl: String(formData.get("baseUrl") ?? "").trim() || null,
      deployBackend: "local",
      deployConfig: {
        path: "/data/workspaces",
      },
      agentWritable: formData.get("agentWritable") === "on",
      autoDeployEnabled: false,
      humanReviewRequired: formData.get("humanReviewRequired") === "on",
      isDefaultForAgent: formData.get("isDefaultForAgent") === "on",
    }),
  })

  if (response.status === 401) {
    redirect("/admin?tab=settings&error=unauthorized")
  }

  redirect("/admin?tab=settings")
}
