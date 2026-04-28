import { redirect } from "next/navigation"
import { createAuditLog, createChangeRequest, getDefaultTargetEnvironmentForApp } from "@/lib/app-core"

import { adminFetch } from "@/lib/admin"
import {
  requireLocalAdminAccess,
  trackedChangeRequestPriorities,
  trackedChangeRequestTypes,
  useLocalAppApi,
} from "@/lib/local-admin-api"

export async function POST(request: Request) {
  const formData = await request.formData()
  const title = String(formData.get("title") ?? "").trim()
  const description = String(formData.get("description") ?? "").trim()
  const requestType = String(formData.get("requestType") ?? "bug").trim()
  const priority = String(formData.get("priority") ?? "normal").trim()
  const targetAppId = String(formData.get("targetAppId") ?? "").trim()

  if (useLocalAppApi()) {
    const access = await requireLocalAdminAccess()
    if (!access.ok) {
      redirect("/admin?error=unauthorized")
    }

    if (
      !title ||
      !description ||
      !targetAppId ||
      !trackedChangeRequestTypes.includes(requestType as typeof trackedChangeRequestTypes[number]) ||
      !trackedChangeRequestPriorities.includes(priority as typeof trackedChangeRequestPriorities[number])
    ) {
      redirect("/admin?error=request-create")
    }

    const changeRequest = createChangeRequest({
      title,
      description,
      requestType,
      priority,
      status: "submitted",
      source: "manual",
      requestedByUserId: null,
      targetAppId,
      targetEnvironmentId: getDefaultTargetEnvironmentForApp(targetAppId)?.id ?? null,
      acceptanceCriteria: [],
      constraints: {},
      attachments: [],
    })

    createAuditLog({
      actorUserId: null,
      actionType: "admin.change_board_request.create",
      targetType: "change_request",
      targetId: changeRequest?.id ?? null,
      meta: { requestType, priority, targetAppId, status: "submitted" },
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
      targetAppId,
      status: "submitted",
    }),
  })

  if (response.status === 401) {
    redirect("/admin?error=unauthorized")
  }

  redirect("/admin")
}
