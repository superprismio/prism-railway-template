import { NextResponse } from "next/server"

import { adminFetch, getAdminPasswordCookie } from "@/lib/admin"

export type PrismArtifactSummary = {
  id: string
  category: string
  status: string
  path: string
  filename: string
  source?: string | null
  type?: string | null
  created_at: string
  bucket?: string | null
  author?: string | null
  url?: string | null
  participants?: string[] | null
  participant_count?: number | null
  content_length: number
  preview: string
}

export type PrismArtifactDetail = PrismArtifactSummary & {
  content: string
  payload: Record<string, unknown>
}

export type PrismKnowledgeSource = {
  id: string
  kind: string
  repo_url: string
  branch: string
  label: string
  content_policy: string
  docs_roots: string[]
  include: string[]
  exclude: string[]
  sync_mode: string
  managed_by: string
  default_kind: string
  default_tags: string[]
  owner: string
  audience: string
  stability: string
  status: string
  last_synced_commit?: string | null
  last_synced_at?: string | null
  created_at: string
  updated_at: string
  state: {
    source_id: string
    status: string
    last_requested_at?: string | null
    last_started_at?: string | null
    last_completed_at?: string | null
    last_synced_at?: string | null
    last_synced_commit?: string | null
    file_count: number
    doc_count: number
    docs_roots: string[]
    change_summary: Record<string, number>
    error?: { code?: string; message?: string } | null
    current_step?: string | null
  }
}

export type PrismKnowledgeSearchResult = {
  slug?: string
  title?: string
  kind?: string
  summary?: string
  tags?: string[]
  entities?: string[]
  source_url?: string
  source_path?: string
  updated?: string
  [key: string]: unknown
}

export type PrismKnowledgeDoc = PrismKnowledgeSearchResult & {
  content?: string
}

function prismMemoryBaseUrl() {
  return (
    process.env.PRISM_MEMORY_BASE_URL ||
    process.env.PRISM_API_BASE ||
    ""
  ).trim().replace(/\/+$/, "")
}

function prismMemoryReadKey() {
  return (
    process.env.PRISM_API_READ_KEY ||
    process.env.PRISM_API_KEY ||
    ""
  ).trim()
}

async function requireAdminAccess() {
  const password = await getAdminPasswordCookie()
  if (!password) {
    return {
      ok: false as const,
      status: 401,
      error: "Unauthorized",
    }
  }

  try {
    const response = await adminFetch("/api/admin/setup/status")
    if (response.ok) {
      return { ok: true as const }
    }

    if (response.status === 401) {
      return {
        ok: false as const,
        status: 401,
        error: "Unauthorized",
      }
    }

    return {
      ok: false as const,
      status: 502,
      error: `Admin API request failed with ${response.status}`,
    }
  } catch (error) {
    return {
      ok: false as const,
      status: 502,
      error:
        error instanceof Error
          ? error.message
          : "Admin API request failed",
    }
  }
}

function copyAllowedSearchParams(
  source: URLSearchParams,
  allowedParams: string[],
) {
  const output = new URLSearchParams()
  for (const key of allowedParams) {
    const value = source.get(key)
    if (value !== null && value.trim() !== "") {
      output.set(key, value)
    }
  }
  return output
}

export async function proxyPrismMemoryJson(
  path: string,
  incomingSearchParams: URLSearchParams,
  allowedParams: string[] = [],
) {
  const access = await requireAdminAccess()
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    )
  }

  const baseUrl = prismMemoryBaseUrl()
  const readKey = prismMemoryReadKey()

  if (!baseUrl) {
    return NextResponse.json(
      { ok: false, error: "PRISM_MEMORY_BASE_URL is not configured" },
      { status: 500 },
    )
  }

  if (!readKey) {
    return NextResponse.json(
      { ok: false, error: "PRISM_API_READ_KEY or PRISM_API_KEY is not configured" },
      { status: 500 },
    )
  }

  const url = new URL(`${baseUrl}${path}`)
  const safeParams = copyAllowedSearchParams(incomingSearchParams, allowedParams)
  for (const [key, value] of safeParams.entries()) {
    url.searchParams.set(key, value)
  }

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "X-Prism-Api-Key": readKey,
      },
    })
    const text = await response.text()
    const contentType = response.headers.get("content-type") ?? "application/json"

    return new NextResponse(text, {
      status: response.status,
      headers: {
        "content-type": contentType,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Prism Memory request failed",
      },
      { status: 502 },
    )
  }
}
