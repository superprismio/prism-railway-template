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

  const response = await adminFetch("/api/admin/target-apps", {
    method: "POST",
    body: JSON.stringify({
      slug,
      name,
      description: String(formData.get("description") ?? "").trim(),
      repoUrl: String(formData.get("repoUrl") ?? "").trim(),
      repoProvider: "github",
      defaultBranch: String(formData.get("defaultBranch") ?? "main").trim() || "main",
      framework: String(formData.get("framework") ?? "").trim() || null,
      deployBackend: "github",
      deployConfig: {
        workspace: "external",
      },
      agentEnabled: true,
    }),
  })

  if (response.status === 401) {
    redirect("/admin/settings?error=unauthorized")
  }

  redirect("/admin/settings")
}
