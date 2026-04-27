import { proxyPrismMemoryJson } from "@/lib/prism-memory"

const allowedParams = ["q", "kind", "tag", "entity", "limit"]

export async function GET(request: Request) {
  const url = new URL(request.url)
  return proxyPrismMemoryJson("/knowledge/search", url.searchParams, allowedParams)
}
