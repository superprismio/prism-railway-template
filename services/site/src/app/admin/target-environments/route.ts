import { redirect } from "next/navigation"

import { adminFetch } from "@/lib/admin"

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

  const response = await adminFetch("/api/admin/target-environments", {
    method: "POST",
    body: JSON.stringify({
      targetAppId: String(formData.get("targetAppId") ?? "").trim(),
      slug,
      name,
      kind: String(formData.get("kind") ?? "development").trim() || "development",
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
    redirect("/admin/settings?error=unauthorized")
  }

  redirect("/admin/settings")
}
