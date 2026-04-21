import { NextResponse } from "next/server"

import { adminFetch } from "@/lib/admin"

export async function POST(request: Request) {
  let payload: unknown = null

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const response = await adminFetch("/api/v1/responses", {
    method: "POST",
    body: JSON.stringify(payload),
  })

  const text = await response.text()
  const contentType = response.headers.get("content-type") ?? "application/json"

  return new NextResponse(text, {
    status: response.status,
    headers: {
      "content-type": contentType,
    },
  })
}
