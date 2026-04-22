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
  const defaultBranch = String(formData.get("defaultBranch") ?? "main").trim() || "main"
  const baseUrl = String(formData.get("baseUrl") ?? "").trim()

  const response = await adminFetch("/api/admin/target-apps", {
    method: "POST",
    body: JSON.stringify({
      slug,
      name,
      description: String(formData.get("description") ?? "").trim(),
      repoUrl: String(formData.get("repoUrl") ?? "").trim(),
      repoProvider: "github",
      defaultBranch,
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

  if (!response.ok) {
    redirect("/admin/settings?error=target-app")
  }

  const payload = (await response.json()) as { targetApp?: { id?: string } }
  const targetAppId = payload.targetApp?.id

  if (!targetAppId) {
    redirect("/admin/settings?error=target-app")
  }

  const environmentResponse = await adminFetch("/api/admin/target-environments", {
    method: "POST",
    body: JSON.stringify({
      targetAppId,
      slug: `${slug || "repo"}-default`,
      name: "Default",
      kind: "development",
      branch: defaultBranch,
      baseUrl: baseUrl || null,
      deployBackend: "local",
      deployConfig: {
        path: "/data/workspaces",
      },
      agentWritable: true,
      autoDeployEnabled: false,
      humanReviewRequired: true,
      isDefaultForAgent: true,
    }),
  })

  if (environmentResponse.status === 401) {
    redirect("/admin/settings?error=unauthorized")
  }

  if (!environmentResponse.ok) {
    redirect("/admin/settings?error=target-environment")
  }

  redirect("/admin/settings")
}
