import { proxyPrismMemoryJson } from "@/lib/prism-memory"

const allowedParams = ["category", "type", "source", "status", "limit"]

export async function GET(request: Request) {
  const url = new URL(request.url)
  return proxyPrismMemoryJson("/api/artifacts", url.searchParams, allowedParams)
}
