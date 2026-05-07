import { loadConfig, readSiteContent, writeSiteContent } from "@/lib/app-core"

export function currentSiteBranding() {
  return readSiteContent(loadConfig()).shell
}

export function updateSiteBranding(input: Record<string, unknown>) {
  const config = loadConfig()
  const current = readSiteContent(config)
  const shell = input.shell && typeof input.shell === "object" && !Array.isArray(input.shell)
    ? input.shell as Record<string, unknown>
    : input

  const next = {
    ...current,
    shell: {
      ...current.shell,
      brandName: typeof shell.brandName === "string" ? shell.brandName.trim() : current.shell.brandName,
      logoUrl: typeof shell.logoUrl === "string" ? shell.logoUrl.trim() : current.shell.logoUrl,
      logoAlt: typeof shell.logoAlt === "string" ? shell.logoAlt.trim() : current.shell.logoAlt,
      workspaceLabel: typeof shell.workspaceLabel === "string" ? shell.workspaceLabel.trim() : current.shell.workspaceLabel,
    },
  }

  return writeSiteContent(config, next).shell
}
