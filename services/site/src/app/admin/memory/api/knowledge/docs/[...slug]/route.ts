import { proxyPrismMemoryJson } from "@/lib/prism-memory"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await params
  const path = slug.map((part) => encodeURIComponent(part)).join("/")
  const url = new URL(request.url)
  return proxyPrismMemoryJson(`/knowledge/docs/${path}`, url.searchParams)
}
