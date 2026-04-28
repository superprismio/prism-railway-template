import { cookies } from "next/headers"
import { getAdminBoardSnapshot, getAdminSetupStatus, loadConfig } from "@/lib/app-core"

export const adminPasswordCookieName = "prism_admin_password"

function useLocalAppApi() {
  return process.env.SITE_USE_LOCAL_APP_API?.trim() === "true"
}

export const siteApiBase =
  process.env.API_INTERNAL_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://127.0.0.1:4010"

export type TargetAppRecord = {
  id: string
  slug: string
  name: string
  description: string | null
  repoUrl: string | null
  repoProvider: string | null
  defaultBranch: string
  framework: string | null
  deployBackend: string
  deployConfig: Record<string, unknown>
  agentEnabled: boolean
  createdAt: string
  updatedAt: string
}

export type TargetEnvironmentRecord = {
  id: string
  targetAppId: string
  targetAppSlug: string | null
  slug: string
  name: string
  kind: string
  branch: string | null
  baseUrl: string | null
  deployBackend: string
  deployConfig: Record<string, unknown>
  agentWritable: boolean
  autoDeployEnabled: boolean
  humanReviewRequired: boolean
  isDefaultForAgent: boolean
  createdAt: string
  updatedAt: string
}

export type ChangeRequestRecord = {
  id: string
  requestNumber: number
  title: string
  description: string
  requestType: string
  status: string
  priority: string
  source: string
  requestedByUserId: string | null
  requestedByDisplayName: string | null
  targetAppId: string
  targetAppSlug: string | null
  targetAppName: string | null
  targetEnvironmentId: string | null
  targetEnvironmentSlug: string | null
  targetEnvironmentName: string | null
  triageSummary: string | null
  acceptanceCriteria: unknown[]
  constraints: Record<string, unknown>
  attachments: unknown[]
  agentRecommendation: string | null
  reviewNotes: string | null
  resolutionSummary: string | null
  createdAt: string
  updatedAt: string
  triagedAt: string | null
  approvedForWorkAt: string | null
  completedAt: string | null
  closedAt: string | null
}

export type ChangeRequestExecutionRecord = {
  id: string
  changeRequestId: string
  targetEnvironmentId: string | null
  targetEnvironmentSlug: string | null
  status: string
  actorType: string
  branchName: string | null
  commitSha: string | null
  deployUrl: string | null
  adapterKind: string | null
  adapterStatus: string | null
  summary: string | null
  errorMessage: string | null
  meta: Record<string, unknown>
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type AdminSetupStatus = {
  prismMemory: {
    configured: boolean
    reachable: boolean
    status: number | null
    error: string | null
    space: string | null
  }
  codexRuntime: {
    configured: boolean
    reachable: boolean
    status: number | null
    error: string | null
    codexAuthConfigured: boolean
    codexHome: string | null
  }
  targets: {
    targetAppCount: number
    targetEnvironmentCount: number
  }
  community: {
    provider: string | null
  }
}

export type AdminBoardData = {
  targetApps: TargetAppRecord[]
  targetEnvironments: TargetEnvironmentRecord[]
  changeRequests: ChangeRequestRecord[]
}

export type AdminWorkspaceData = AdminBoardData & {
  setup: AdminSetupStatus
}

export async function getAdminPasswordCookie() {
  return (await cookies()).get(adminPasswordCookieName)?.value ?? null
}

export async function adminFetch(path: string, init?: RequestInit) {
  const password = await getAdminPasswordCookie()

  const response = await fetch(`${siteApiBase}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(password ? { "x-admin-password": password } : {}),
      ...(init?.headers ?? {}),
    },
  })

  return response
}

async function requireLocalAdminPassword() {
  const password = await getAdminPasswordCookie()
  if (!password) {
    return { ok: false as const, reason: "missing-password" as const }
  }

  const config = loadConfig()
  if (password !== config.adminPassword) {
    return { ok: false as const, reason: "unauthorized" as const }
  }

  return { ok: true as const }
}

export async function getAdminBoardData(): Promise<
  { ok: true; data: AdminBoardData } | { ok: false; reason: "missing-password" | "unauthorized" | "error" }
> {
  if (useLocalAppApi()) {
    const access = await requireLocalAdminPassword()
    if (!access.ok) {
      return access
    }

    try {
      return {
        ok: true,
        data: getAdminBoardSnapshot(),
      }
    } catch {
      return { ok: false, reason: "error" }
    }
  }

  const password = await getAdminPasswordCookie()
  if (!password) {
    return { ok: false, reason: "missing-password" }
  }

  try {
    const [targetAppsResponse, targetEnvironmentsResponse, changeRequestsResponse] = await Promise.all([
      adminFetch("/api/admin/target-apps"),
      adminFetch("/api/admin/target-environments"),
      adminFetch("/api/admin/change-board/requests"),
    ])

    if (
      targetAppsResponse.status === 401 ||
      targetEnvironmentsResponse.status === 401 ||
      changeRequestsResponse.status === 401
    ) {
      return { ok: false, reason: "unauthorized" }
    }

    if (
      !targetAppsResponse.ok ||
      !targetEnvironmentsResponse.ok ||
      !changeRequestsResponse.ok
    ) {
      return { ok: false, reason: "error" }
    }

    const [targetAppsJson, targetEnvironmentsJson, changeRequestsJson] = await Promise.all([
      targetAppsResponse.json() as Promise<{ targetApps: TargetAppRecord[] }>,
      targetEnvironmentsResponse.json() as Promise<{ targetEnvironments: TargetEnvironmentRecord[] }>,
      changeRequestsResponse.json() as Promise<{ changeRequests: ChangeRequestRecord[] }>,
    ])

    return {
      ok: true,
      data: {
        targetApps: targetAppsJson.targetApps,
        targetEnvironments: targetEnvironmentsJson.targetEnvironments,
        changeRequests: changeRequestsJson.changeRequests,
      },
    }
  } catch {
    return { ok: false, reason: "error" }
  }
}

export async function getAdminWorkspaceData(): Promise<
  { ok: true; data: AdminWorkspaceData } | { ok: false; reason: "missing-password" | "unauthorized" | "error" }
> {
  if (useLocalAppApi()) {
    const access = await requireLocalAdminPassword()
    if (!access.ok) {
      return access
    }

    try {
      return {
        ok: true,
        data: {
          ...getAdminBoardSnapshot(),
          setup: await getAdminSetupStatus(),
        },
      }
    } catch {
      return { ok: false, reason: "error" }
    }
  }

  const password = await getAdminPasswordCookie()
  if (!password) {
    return { ok: false, reason: "missing-password" }
  }

  try {
    const [board, setupResponse] = await Promise.all([
      getAdminBoardData(),
      adminFetch("/api/admin/setup/status"),
    ])

    if (!board.ok) {
      return board
    }

    if (setupResponse.status === 401) {
      return { ok: false, reason: "unauthorized" }
    }

    if (!setupResponse.ok) {
      return { ok: false, reason: "error" }
    }

    const setupJson = (await setupResponse.json()) as {
      setup: AdminSetupStatus
    }

    return {
      ok: true,
      data: {
        ...board.data,
        setup: setupJson.setup,
      },
    }
  } catch {
    return { ok: false, reason: "error" }
  }
}
