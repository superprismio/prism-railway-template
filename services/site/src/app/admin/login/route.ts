import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { adminPasswordCookieName } from "@/lib/admin"

export async function POST(request: Request) {
  const formData = await request.formData()
  const password = typeof formData.get("password") === "string" ? String(formData.get("password")).trim() : ""

  if (!password) {
    redirect("/admin?error=missing-password")
  }

  ;(await cookies()).set(adminPasswordCookieName, password, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  })

  redirect("/admin")
}
