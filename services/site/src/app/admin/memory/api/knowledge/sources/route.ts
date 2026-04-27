import { proxyPrismMemoryJson } from "@/lib/prism-memory"

export async function GET(request: Request) {
  const url = new URL(request.url)
  return proxyPrismMemoryJson("/knowledge/sources", url.searchParams)
}
