import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { adminSessionCookieName, legacyAdminPasswordCookieName } from "@/lib/admin-auth"

export async function POST() {
  const cookieStore = await cookies()
  cookieStore.delete(adminSessionCookieName)
  cookieStore.delete(legacyAdminPasswordCookieName)
  redirect("/admin")
}
