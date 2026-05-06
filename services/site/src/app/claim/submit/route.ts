import bcrypt from "bcryptjs"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { claimUserInvite } from "@/lib/app-core"
import {
  adminSessionCookieName,
  adminSessionMaxAgeSeconds,
  createAdminSessionCookieValue,
  legacyAdminPasswordCookieName,
} from "@/lib/admin-auth"

const { hash } = bcrypt

export async function POST(request: Request) {
  const formData = await request.formData()
  const token = typeof formData.get("token") === "string" ? String(formData.get("token")).trim() : ""
  const password = typeof formData.get("password") === "string" ? String(formData.get("password")) : ""
  const displayName = typeof formData.get("displayName") === "string" ? String(formData.get("displayName")).trim() : ""

  if (!token || password.length < 10) {
    redirect(`/claim?${new URLSearchParams({
      ...(token ? { token } : {}),
      error: password.length < 10 ? "short-password" : "invalid",
    }).toString()}`)
  }

  try {
    const user = await claimUserInvite({
      token,
      passwordHash: await hash(password, 10),
      displayName: displayName || null,
    })

    if (!user) {
      redirect(`/claim?${new URLSearchParams({ token, error: "invalid" }).toString()}`)
    }

    const cookieStore = await cookies()
    cookieStore.delete(legacyAdminPasswordCookieName)
    cookieStore.set(adminSessionCookieName, createAdminSessionCookieValue({
      userId: user.id,
      roleSlugs: user.roleSlugs.length ? user.roleSlugs : ["member"],
    }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: adminSessionMaxAgeSeconds(),
    })
  } catch {
    redirect(`/claim?${new URLSearchParams({ token, error: "invalid" }).toString()}`)
  }

  redirect("/admin")
}
