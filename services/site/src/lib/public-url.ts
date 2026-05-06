function normalizePublicOrigin(value: string | null | undefined) {
  const raw = value?.trim().replace(/\/+$/, "")
  if (!raw) return null
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`

  try {
    const url = new URL(withScheme)
    if (["0.0.0.0", "127.0.0.1", "localhost"].includes(url.hostname)) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

export function publicOriginFromRequest(request: Request) {
  const configured =
    normalizePublicOrigin(process.env.SITE_PUBLIC_URL) ||
    normalizePublicOrigin(process.env.PUBLIC_SITE_URL) ||
    normalizePublicOrigin(process.env.NEXT_PUBLIC_SITE_URL) ||
    normalizePublicOrigin(process.env.APP_URL) ||
    normalizePublicOrigin(process.env.RAILWAY_PUBLIC_DOMAIN)
  if (configured) return configured

  const forwardedHost = request.headers.get("x-forwarded-host")
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https"
  const forwardedOrigin = normalizePublicOrigin(
    forwardedHost ? `${forwardedProto}://${forwardedHost.split(",")[0]?.trim()}` : null,
  )
  if (forwardedOrigin) return forwardedOrigin

  const host = request.headers.get("host")
  const protocol = host?.includes("localhost") || host?.includes("127.0.0.1") ? "http" : "https"
  return normalizePublicOrigin(host ? `${protocol}://${host}` : null) || new URL(request.url).origin
}

export function publicUrlFromRequest(request: Request, path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return `${publicOriginFromRequest(request)}${normalizedPath}`
}
