import { redirect } from "next/navigation"

import { adminFetch } from "@/lib/admin"

export async function POST(request: Request) {
  const formData = await request.formData()

  const response = await adminFetch("/api/admin/change-board/requests", {
    method: "POST",
    body: JSON.stringify({
      title: String(formData.get("title") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim(),
      requestType: String(formData.get("requestType") ?? "bug").trim(),
      priority: String(formData.get("priority") ?? "normal").trim(),
      targetAppId: String(formData.get("targetAppId") ?? "").trim(),
      status: "submitted",
    }),
  })

  if (response.status === 401) {
    redirect("/admin?error=unauthorized")
  }

  redirect("/admin")
}
