import manifest from "../../../../prism-version.json"

export type PrismUpdateState =
  | "current"
  | "update_available"
  | "newer"
  | "unknown"

export type PrismUpdateStatus = {
  state: PrismUpdateState
  updateReason: "version" | "commits" | null
  currentVersion: string
  latestVersion: string | null
  channel: string
  repository: string
  branch: string
  buildSha: string | null
  buildBranch: string | null
  latestSha: string | null
  checkedAt: string | null
  changesUrl: string
  error: string | null
}

type VersionManifest = {
  version: string
  channel: string
  repository: string
  branch: string
}

type CommitComparison = {
  status?: unknown
  behind_by?: unknown
  files?: unknown
  head_commit?: { sha?: unknown }
}

type CachedUpdate = {
  expiresAt: number
  value: PrismUpdateStatus
}

type UpdateFetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

const successCacheTtlMs = 6 * 60 * 60 * 1000
const failureCacheTtlMs = 15 * 60 * 1000
let cachedUpdate: CachedUpdate | null = null
let pendingUpdate: Promise<PrismUpdateStatus> | null = null

function normalizeSha(value: string | undefined) {
  const normalized = value?.trim()
  return normalized && /^[a-f0-9]{7,40}$/i.test(normalized) ? normalized : null
}

function versionParts(value: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim())
  if (!match) return null
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  }
}

export function comparePrismVersions(left: string, right: string) {
  const leftParts = versionParts(left)
  const rightParts = versionParts(right)
  if (!leftParts || !rightParts) return null

  for (let index = 0; index < leftParts.numbers.length; index += 1) {
    if (leftParts.numbers[index] !== rightParts.numbers[index]) {
      return leftParts.numbers[index] < rightParts.numbers[index] ? -1 : 1
    }
  }

  if (leftParts.prerelease === rightParts.prerelease) return 0
  if (leftParts.prerelease === null) return 1
  if (rightParts.prerelease === null) return -1
  return leftParts.prerelease.localeCompare(rightParts.prerelease)
}

export function currentPrismBuild() {
  return {
    version: manifest.version,
    channel: manifest.channel,
    repository: manifest.repository,
    branch: manifest.branch,
    buildSha: normalizeSha(
      process.env.PRISM_BUILD_SHA || process.env.RAILWAY_GIT_COMMIT_SHA,
    ),
    buildBranch:
      process.env.PRISM_BUILD_BRANCH?.trim() ||
      process.env.RAILWAY_GIT_BRANCH?.trim() ||
      null,
  }
}

function changesUrl(buildSha: string | null) {
  const baseUrl = `https://github.com/${manifest.repository}`
  return buildSha
    ? `${baseUrl}/compare/${buildSha}...${manifest.branch}`
    : `${baseUrl}/commits/${manifest.branch}`
}

function validateManifest(value: unknown): VersionManifest | null {
  if (!value || typeof value !== "object") return null
  const candidate = value as Partial<VersionManifest>
  if (
    typeof candidate.version !== "string" ||
    typeof candidate.channel !== "string" ||
    candidate.repository !== manifest.repository ||
    candidate.branch !== manifest.branch ||
    !versionParts(candidate.version)
  ) {
    return null
  }
  return candidate as VersionManifest
}

export async function fetchPrismUpdateStatus(
  fetcher: UpdateFetcher = fetch,
): Promise<PrismUpdateStatus> {
  const current = currentPrismBuild()
  const checkedAt = new Date().toISOString()
  const statusBase = {
    currentVersion: current.version,
    channel: current.channel,
    repository: current.repository,
    branch: current.branch,
    buildSha: current.buildSha,
    buildBranch: current.buildBranch,
    checkedAt,
    changesUrl: changesUrl(current.buildSha),
  }

  try {
    const requestInit: RequestInit = {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    }
    const manifestRequest = fetcher(
      `https://raw.githubusercontent.com/${manifest.repository}/${manifest.branch}/prism-version.json`,
      requestInit,
    )
    const comparisonRequest = current.buildSha
      ? fetcher(
        `https://api.github.com/repos/${manifest.repository}/compare/${current.buildSha}...${manifest.branch}`,
        {
          ...requestInit,
          headers: {
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
          },
        },
      )
      : null

    const [response, comparisonResponse] = await Promise.all([
      manifestRequest,
      comparisonRequest,
    ])
    if (!response.ok) {
      throw new Error(`canonical manifest returned HTTP ${response.status}`)
    }
    const latest = validateManifest(await response.json())
    if (!latest) throw new Error("canonical manifest is invalid")
    const versionComparison = comparePrismVersions(current.version, latest.version)
    if (versionComparison === null) throw new Error("installed version is invalid")

    let commitUpdateAvailable = false
    let latestSha: string | null = null
    if (comparisonResponse?.ok) {
      const comparison = await comparisonResponse.json() as CommitComparison
      const changedFiles = Array.isArray(comparison.files) ? comparison.files.length : 0
      commitUpdateAvailable =
        (comparison.status === "behind" || comparison.status === "diverged") &&
        typeof comparison.behind_by === "number" &&
        comparison.behind_by > 0 &&
        changedFiles > 0
      latestSha = typeof comparison.head_commit?.sha === "string"
        ? normalizeSha(comparison.head_commit.sha)
        : null
    }

    const updateReason = versionComparison < 0
      ? "version"
      : commitUpdateAvailable
        ? "commits"
        : null

    return {
      ...statusBase,
      state:
        updateReason
          ? "update_available"
          : versionComparison > 0
            ? "newer"
            : "current",
      updateReason,
      latestVersion: latest.version,
      latestSha,
      error: null,
    }
  } catch (error) {
    return {
      ...statusBase,
      state: "unknown",
      updateReason: null,
      latestVersion: null,
      latestSha: null,
      error: error instanceof Error ? error.message : "update check failed",
    }
  }
}

export async function getPrismUpdateStatus() {
  const now = Date.now()
  if (cachedUpdate && cachedUpdate.expiresAt > now) return cachedUpdate.value
  if (pendingUpdate) return pendingUpdate

  pendingUpdate = fetchPrismUpdateStatus()
    .then((value) => {
      cachedUpdate = {
        expiresAt:
          Date.now() + (value.state === "unknown" ? failureCacheTtlMs : successCacheTtlMs),
        value,
      }
      return value
    })
    .finally(() => {
      pendingUpdate = null
    })
  return pendingUpdate
}
