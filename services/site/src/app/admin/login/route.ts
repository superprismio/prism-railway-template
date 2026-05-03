import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { loadConfig } from "@/lib/app-core"
import {
  adminSessionCookieName,
  adminSessionMaxAgeSeconds,
  createAdminSessionCookieValue,
  legacyAdminPasswordCookieName,
} from "@/lib/admin-auth"

export async function POST(request: Request) {
  const formData = await request.formData()
  const password = typeof formData.get("password") === "string" ? String(formData.get("password")).trim() : ""

  if (!password) {
    redirect("/admin?error=missing-password")
  }

  if (password !== loadConfig().adminPassword) {
    redirect("/admin?error=unauthorized")
  }

  const cookieStore = await cookies()
  cookieStore.delete(legacyAdminPasswordCookieName)
  cookieStore.set(adminSessionCookieName, createAdminSessionCookieValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: adminSessionMaxAgeSeconds(),
  })

  redirect("/admin")
}
