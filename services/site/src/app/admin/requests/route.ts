import { redirect } from "next/navigation"
import { createAuditLog, createChangeRequest, getDefaultTargetEnvironmentForApp, getWorkflowByKey } from "@/lib/app-core"

import { adminFetch } from "@/lib/admin"
import {
  requireLocalAdminAccess,
  trackedChangeRequestPriorities,
  trackedChangeRequestTypes,
  useLocalAppApi,
} from "@/lib/local-admin-api"

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export async function POST(request: Request) {
  const formData = await request.formData()
  const title = String(formData.get("title") ?? "").trim()
  const description = String(formData.get("description") ?? "").trim()
  const requestType = String(formData.get("requestType") ?? "bug").trim()
  const priority = String(formData.get("priority") ?? "normal").trim()
  const targetAppId = String(formData.get("targetAppId") ?? "").trim()
  const workflowKey = String(formData.get("workflowKey") ?? "change-request-default").trim() || "change-request-default"

  if (useLocalAppApi()) {
    const access = await requireLocalAdminAccess()
    if (!access.ok) {
      redirect("/admin?error=unauthorized")
    }

    const workflow = getWorkflowByKey(workflowKey)
    const target = workflow?.definition?.target
    const targetRequired = workflowKey === "change-request-default"
      || (isRecord(target) && target.required === true)

    if (
      !title ||
      !description ||
      !workflow ||
      (targetRequired && !targetAppId) ||
      !trackedChangeRequestTypes.includes(requestType as typeof trackedChangeRequestTypes[number]) ||
      !trackedChangeRequestPriorities.includes(priority as typeof trackedChangeRequestPriorities[number])
    ) {
      redirect("/admin?error=request-create")
    }

    const changeRequest = createChangeRequest({
      title,
      description,
      workflowKey,
      requestType,
      priority,
      status: "submitted",
      source: "manual",
      requestedByUserId: null,
      targetAppId: targetAppId || null,
      targetEnvironmentId: targetAppId ? getDefaultTargetEnvironmentForApp(targetAppId)?.id ?? null : null,
      acceptanceCriteria: [],
      constraints: {},
      attachments: [],
    })

    createAuditLog({
      actorUserId: null,
      actionType: "admin.change_board_request.create",
      targetType: "change_request",
      targetId: changeRequest?.id ?? null,
      meta: { requestType, priority, workflowKey, targetAppId: targetAppId || null, status: "submitted" },
    })

    redirect("/admin")
  }

  const response = await adminFetch("/api/admin/change-board/requests", {
    method: "POST",
    body: JSON.stringify({
      title,
      description,
      requestType,
      priority,
      workflowKey,
      targetAppId: targetAppId || null,
      status: "submitted",
    }),
  })

  if (response.status === 401) {
    redirect("/admin?error=unauthorized")
  }

  redirect("/admin")
}
