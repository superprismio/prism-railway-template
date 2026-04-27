import { proxyPrismMemoryJson } from "@/lib/prism-memory"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const url = new URL(request.url)
  return proxyPrismMemoryJson(
    `/api/artifacts/${encodeURIComponent(id)}`,
    url.searchParams,
  )
}
